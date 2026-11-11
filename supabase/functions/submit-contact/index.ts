import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function respond(body: Record<string, unknown>, status: number, origin: string) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...jsonHeaders,
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, apikey, content-type",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Vary": "Origin"
        }
    });
}

function cleanText(value: unknown) {
    return typeof value === "string"
        ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
        : "";
}

function isValidEmail(value: string) {
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character] ?? character);
}

async function hashAddress(address: string, secret: string) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(value: string) {
    return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createSubmissionToken(jwtSecret: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({
        iss: "supabase",
        aud: "authenticated",
        role: "anon",
        portfolio_contact: "submit",
        iat: now,
        exp: now + 60
    }));
    const signingInput = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)));
    const encodedSignature = btoa(String.fromCharCode(...signature))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    return `${signingInput}.${encodedSignature}`;
}

Deno.serve(async (request) => {
    const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");
    if (!siteUrl) {
        return new Response(JSON.stringify({ success: false, error: "The contact service is not configured." }), {
            status: 503,
            headers: jsonHeaders
        });
    }

    const allowedOrigin = new URL(siteUrl).origin;
    const origin = request.headers.get("origin");
    if (origin !== allowedOrigin) {
        return new Response(JSON.stringify({ success: false, error: "This request is not allowed." }), {
            status: 403,
            headers: jsonHeaders
        });
    }

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": allowedOrigin,
                "Access-Control-Allow-Headers": "authorization, apikey, content-type",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Vary": "Origin"
            }
        });
    }

    if (request.method !== "POST") {
        return respond({ success: false, error: "Use POST to submit a message." }, 405, allowedOrigin);
    }

    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return respond({ success: false, error: "Submit the message as JSON." }, 415, allowedOrigin);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12000) {
        return respond({ success: false, error: "The request is too large." }, 413, allowedOrigin);
    }

    const rawBody = await request.text();
    if (rawBody.length > 12000) {
        return respond({ success: false, error: "The request is too large." }, 413, allowedOrigin);
    }

    let parsedBody: unknown;
    try {
        parsedBody = JSON.parse(rawBody);
    } catch {
        return respond({ success: false, error: "Please submit a valid message." }, 400, allowedOrigin);
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        return respond({ success: false, error: "Please submit a valid message." }, 400, allowedOrigin);
    }
    const input = parsedBody as Record<string, unknown>;

    const fullName = cleanText(input.full_name);
    const email = cleanText(input.email).toLowerCase();
    const subject = cleanText(input.subject);
    const message = cleanText(input.message);

    if (cleanText(input.website)) {
        return respond({ success: false, error: "The message could not be accepted." }, 400, allowedOrigin);
    }
    if (fullName.length < 2 || fullName.length > 100) {
        return respond({ success: false, error: "Enter a name between 2 and 100 characters." }, 400, allowedOrigin);
    }
    if (!isValidEmail(email)) {
        return respond({ success: false, error: "Enter a valid email address." }, 400, allowedOrigin);
    }
    if (subject.length < 3 || subject.length > 120) {
        return respond({ success: false, error: "Enter a subject between 3 and 120 characters." }, 400, allowedOrigin);
    }
    if (message.length < 10 || message.length > 5000) {
        return respond({ success: false, error: "Enter a message between 10 and 5000 characters." }, 400, allowedOrigin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    const hmacSecret = Deno.env.get("RATE_LIMIT_HMAC_SECRET");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !jwtSecret || !hmacSecret || !anonKey || hmacSecret.length < 32) {
        console.error("Contact function is missing required server configuration.");
        return respond({ success: false, error: "The contact service is temporarily unavailable." }, 503, allowedOrigin);
    }

    const clientApiKey = request.headers.get("apikey");
    if (clientApiKey !== anonKey) {
        return respond({ success: false, error: "This request is not allowed." }, 401, allowedOrigin);
    }

    const forwardedAddress = request.headers.get("cf-connecting-ip")
        || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (!forwardedAddress || forwardedAddress.length > 80 || !/^[0-9a-fA-F:.]+$/.test(forwardedAddress)) {
        console.error("Contact submission did not include a proxy-supplied client address.");
        return respond({ success: false, error: "The contact service could not verify this request." }, 503, allowedOrigin);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    const ipHash = await hashAddress(forwardedAddress, hmacSecret);
    const { data: withinLimit, error: rateLimitError } = await supabase.rpc(
        "consume_contact_submission",
        { p_ip_hash: ipHash }
    );
    if (rateLimitError) {
        console.error("Contact rate-limit check failed:", rateLimitError.message);
        return respond({ success: false, error: "The contact service is temporarily unavailable." }, 503, allowedOrigin);
    }
    if (withinLimit !== true) {
        return new Response(JSON.stringify({
            success: false,
            error: "Too many messages were sent from this connection. Please try again in 15 minutes."
        }), {
            status: 429,
            headers: { ...jsonHeaders, "Retry-After": "900", "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin" }
        });
    }

    const submissionToken = await createSubmissionToken(jwtSecret);
    let insertResponse: Response;
    try {
        insertResponse = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/contact_messages`, {
            method: "POST",
            headers: {
                "apikey": anonKey,
                "Authorization": `Bearer ${submissionToken}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            body: JSON.stringify({ full_name: fullName, email, subject, message }),
            signal: AbortSignal.timeout(10000)
        });
    } catch (error) {
        console.error("Contact message could not be confirmed as saved:", error);
        return respond({ success: false, error: "Your message could not be confirmed. Please try again or email Julius directly." }, 503, allowedOrigin);
    }
    if (!insertResponse.ok) {
        console.error("Contact message insert was rejected:", insertResponse.status);
        return respond({ success: false, error: "Your message could not be saved. Please try again or email Julius directly." }, 500, allowedOrigin);
    }

    const notificationEmail = Deno.env.get("NOTIFICATION_EMAIL");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!notificationEmail || !resendApiKey || !fromEmail) {
        console.error("Message was saved, but email notification configuration is incomplete.");
        return respond({ success: true, notification: "failed" }, 200, allowedOrigin);
    }

    const dashboardUrl = `${siteUrl}/admin/`;
    const safeName = escapeHtml(fullName);
    const safeEmail = escapeHtml(email);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message).replace(/\r?\n/g, "<br>");
    let notificationSent = false;

    try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${resendApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [notificationEmail],
                reply_to: email,
                subject: `New portfolio message: ${subject}`,
                html: `<h2>New portfolio contact message</h2>
                    <p><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
                    <p><strong>Subject:</strong> ${safeSubject}</p>
                    <p>${safeMessage}</p>
                    <p><a href="${escapeHtml(dashboardUrl)}">Open the administrator inbox</a></p>`
            }),
            signal: AbortSignal.timeout(10000)
        });
        if (emailResponse.ok) {
            notificationSent = true;
        } else {
            console.error("Resend rejected the notification:", emailResponse.status, (await emailResponse.text()).slice(0, 1000));
        }
    } catch (error) {
        console.error("Email notification failed after the message was saved:", error);
    }

    return respond({ success: true, notification: notificationSent ? "sent" : "failed" }, 200, allowedOrigin);
});
