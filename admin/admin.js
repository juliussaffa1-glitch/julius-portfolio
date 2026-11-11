import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.PORTFOLIO_SUPABASE;
const loginPanel = document.getElementById("loginPanel");
const dashboardPanel = document.getElementById("dashboardPanel");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const dashboardStatus = document.getElementById("dashboardStatus");
const listStatus = document.getElementById("listStatus");
const loginButton = document.getElementById("loginButton");
const messageList = document.getElementById("messageList");
const messageDetail = document.getElementById("messageDetail");
const searchInput = document.getElementById("messageSearch");
const statusFilter = document.getElementById("statusFilter");

let supabase;
let currentUserId = null;
let selectedMessageId = null;
let searchTimer;
let refreshSequence = 0;

function setStatus(element, message, state = "") {
    element.textContent = message;
    if (state) {
        element.dataset.state = state;
    } else {
        delete element.dataset.state;
    }
}

function showLogin(message = "", state = "") {
    currentUserId = null;
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
    setStatus(loginStatus, message, state);
}

function showDashboard() {
    loginPanel.hidden = true;
    dashboardPanel.hidden = false;
    setStatus(loginStatus, "");
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
}

function clearDetail() {
    selectedMessageId = null;
    const empty = document.createElement("p");
    empty.className = "empty-detail";
    empty.textContent = "Choose a message to read its full contents.";
    messageDetail.replaceChildren(empty);
}

function renderDetail(message) {
    if (!message) {
        clearDetail();
        return;
    }

    selectedMessageId = message.id;
    messageList.querySelectorAll(".message-list-item").forEach((button) => {
        button.setAttribute("aria-current", String(button.dataset.messageId === message.id));
    });
    const heading = document.createElement("h2");
    heading.textContent = message.subject;

    const sender = document.createElement("p");
    sender.className = "sender";
    sender.textContent = `${message.full_name} `;
    const emailLink = document.createElement("a");
    emailLink.href = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`;
    emailLink.textContent = `<${message.email}>`;
    sender.append(emailLink);

    const date = document.createElement("time");
    date.dateTime = message.created_at;
    date.textContent = formatDate(message.created_at);

    const content = document.createElement("p");
    content.className = "message-content";
    content.textContent = message.message;

    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.setAttribute("aria-label", "Message actions");
    [
        ["read", "Mark as read"],
        ["replied", "Mark as replied"],
        ["archived", "Archive"]
    ].forEach(([status, label]) => {
        if (message.status !== status) {
            const button = document.createElement("button");
            button.className = "btn btn-secondary";
            button.type = "button";
            button.textContent = label;
            button.addEventListener("click", () => updateMessageStatus(message, status, button));
            actions.append(button);
        }
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteMessage(message, deleteButton));
    actions.append(deleteButton);

    messageDetail.replaceChildren(heading, sender, date, content, actions);
}

function renderMessages(messages) {
    messageList.replaceChildren();
    const selected = messages.find((message) => message.id === selectedMessageId);

    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "empty-list";
        empty.textContent = "No messages match these filters.";
        messageList.append(empty);
        clearDetail();
        return;
    }

    messages.forEach((message) => {
        const button = document.createElement("button");
        button.className = "message-list-item";
        button.type = "button";
        button.dataset.messageId = message.id;
        button.setAttribute("aria-current", String(message.id === selectedMessageId));
        button.addEventListener("click", () => renderDetail(message));

        const name = document.createElement("strong");
        name.textContent = message.full_name;
        const subject = document.createElement("span");
        subject.className = "message-item-subject";
        subject.textContent = message.subject;
        const email = document.createElement("span");
        email.textContent = message.email;
        const date = document.createElement("time");
        date.dateTime = message.created_at;
        date.textContent = formatDate(message.created_at);
        const badge = document.createElement("span");
        badge.className = "status-badge";
        badge.textContent = message.status;

        button.append(name, subject, email, date, badge);
        messageList.append(button);
    });

    if (selected) {
        renderDetail(selected);
    } else {
        renderDetail(messages[0]);
    }
}

async function loadCounts() {
    const statuses = ["new", "read", "replied", "archived"];
    const results = await Promise.all(statuses.map((status) => supabase
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", status)));

    const failedResult = results.find((result) => result.error);
    if (failedResult) {
        setStatus(dashboardStatus, `Could not load inbox totals: ${failedResult.error.message}`, "error");
        return;
    }

    const counts = Object.fromEntries(statuses.map((status, index) => [status, results[index].count ?? 0]));
    document.getElementById("newCount").textContent = String(counts.new);
    document.getElementById("readCount").textContent = String(counts.read);
    document.getElementById("archivedCount").textContent = String(counts.archived);
    document.getElementById("totalCount").textContent = String(Object.values(counts).reduce((sum, count) => sum + count, 0));
}

async function loadMessages() {
    const sequence = ++refreshSequence;
    setStatus(listStatus, "Loading messages...");
    let query = supabase
        .from("contact_messages")
        .select("id, full_name, email, subject, message, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

    if (statusFilter.value !== "all") {
        query = query.eq("status", statusFilter.value);
    }

    const search = searchInput.value
        .replace(/[^\p{L}\p{N}@.+\-\s_]/gu, "")
        .trim()
        .slice(0, 80);
    if (search) {
        const term = `%${search}%`;
        query = query.or(`full_name.ilike.${term},email.ilike.${term},subject.ilike.${term}`);
    }

    const { data, error } = await query;
    if (sequence !== refreshSequence) {
        return;
    }
    if (error) {
        setStatus(listStatus, `Could not load messages: ${error.message}`, "error");
        return;
    }

    setStatus(listStatus, data.length === 100 ? "Showing the 100 most recent matching messages." : "");
    renderMessages(data);
}

async function refreshDashboard() {
    setStatus(dashboardStatus, "");
    await Promise.all([loadCounts(), loadMessages()]);
}

async function updateMessageStatus(message, status, button) {
    button.disabled = true;
    setStatus(dashboardStatus, "Updating message...");
    const { error } = await supabase
        .from("contact_messages")
        .update({ status })
        .eq("id", message.id);

    if (error) {
        setStatus(dashboardStatus, `Message status was not updated: ${error.message}`, "error");
        button.disabled = false;
        return;
    }

    setStatus(dashboardStatus, "Message status updated.", "success");
    await refreshDashboard();
}

async function deleteMessage(message, button) {
    if (!window.confirm(`Permanently delete the message from ${message.full_name}? This cannot be undone.`)) {
        return;
    }

    button.disabled = true;
    setStatus(dashboardStatus, "Deleting message...");
    const { error } = await supabase.from("contact_messages").delete().eq("id", message.id);
    if (error) {
        setStatus(dashboardStatus, `Message was not deleted: ${error.message}`, "error");
        button.disabled = false;
        return;
    }

    selectedMessageId = null;
    setStatus(dashboardStatus, "Message deleted.", "success");
    await refreshDashboard();
}

async function initializeDashboard(session) {
    const userId = session?.user?.id;
    if (!userId || currentUserId === userId) {
        return;
    }

    showDashboard();
    setStatus(dashboardStatus, "Checking administrator access...");
    const { data: isAdmin, error } = await supabase.rpc("is_portfolio_admin");
    if (error || isAdmin !== true) {
        await supabase.auth.signOut();
        showLogin(error
            ? "Administrator access could not be verified. Check the Supabase setup and try again."
            : "This account is not authorized to access the administrator inbox.", "error");
        return;
    }

    currentUserId = userId;
    setStatus(dashboardStatus, "");
    await refreshDashboard();
}

if (!config || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) || config.anonKey.length < 30) {
    loginButton.disabled = true;
    setStatus(loginStatus, "Add the Supabase project URL and public anon key to supabase-config.js before signing in.", "error");
} else {
    supabase = createClient(config.url, config.anonKey, {
        auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        loginButton.disabled = true;
        setStatus(loginStatus, "Signing in...");
        const formData = new FormData(loginForm);
        const { data, error } = await supabase.auth.signInWithPassword({
            email: String(formData.get("email")).trim(),
            password: String(formData.get("password"))
        });

        if (error) {
            setStatus(loginStatus, `Sign-in failed: ${error.message}`, "error");
        } else {
            await initializeDashboard(data.session);
        }
        loginButton.disabled = false;
    });

    supabase.auth.onAuthStateChange((_event, session) => {
        window.setTimeout(() => {
            if (session) {
                void initializeDashboard(session);
            } else {
                showLogin();
            }
        }, 0);
    });

    supabase.auth.getSession().then(({ data, error }) => {
        if (error) {
            showLogin("The sign-in session could not be checked. Please sign in again.", "error");
        } else if (data.session) {
            void initializeDashboard(data.session);
        }
    });

    document.getElementById("signOutButton").addEventListener("click", async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            setStatus(dashboardStatus, `Sign out failed: ${error.message}`, "error");
        } else {
            showLogin("You have been signed out.", "success");
        }
    });

    searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => void loadMessages(), 250);
    });
    statusFilter.addEventListener("change", () => void loadMessages());
}
