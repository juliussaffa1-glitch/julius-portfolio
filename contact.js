(() => {
    const form = document.getElementById("contactForm");
    const status = document.getElementById("contactStatus");
    const submitButton = document.getElementById("contactSubmit");
    const config = window.PORTFOLIO_SUPABASE;
    const originalButtonText = submitButton.textContent;

    const isConfigured = config
        && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url)
        && config.anonKey.length > 30;

    const showStatus = (message, state) => {
        status.textContent = message;
        status.dataset.state = state;
    };

    if (!isConfigured) {
        submitButton.disabled = true;
        showStatus("The secure contact service is not configured yet. Please email Julius directly using the address above.", "error");
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitButton.disabled) {
            return;
        }

        const values = Object.fromEntries(new FormData(form));
        const payload = {
            full_name: values.full_name.trim(),
            email: values.email.trim(),
            subject: values.subject.trim(),
            message: values.message.trim(),
            website: values.website.trim()
        };

        if (payload.full_name.length < 2 || payload.subject.length < 3 || payload.message.length < 10) {
            showStatus("Please complete each field with the minimum required information.", "error");
            return;
        }

        if (payload.full_name.length > 100 || payload.email.length > 254
            || payload.subject.length > 120 || payload.message.length > 5000) {
            showStatus("One or more fields exceed the allowed length. Please shorten your message and try again.", "error");
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payload.email)) {
            showStatus("Please enter a valid email address.", "error");
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Sending...";
        form.setAttribute("aria-busy", "true");
        showStatus("Sending your message securely...", "pending");

        try {
            const response = await fetch(`${config.url}/functions/v1/submit-contact`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    apikey: config.anonKey
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (!response.ok || result.success !== true) {
                showStatus(result.error || "Your message could not be submitted. Please try again or email Julius directly.", "error");
                return;
            }

            form.reset();
            if (result.notification === "sent") {
                showStatus("Thank you — your message was received. Julius has been notified and will be in touch.", "success");
            } else {
                showStatus("Your message was saved, but the email alert could not be sent. Julius can still review it in the inbox.", "error");
            }
        } catch (error) {
            console.error("Contact form submission failed:", error);
            showStatus("We couldn't confirm your submission because the service could not be reached. Please try again or email Julius directly.", "error");
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
            form.removeAttribute("aria-busy");
        }
    });
})();
