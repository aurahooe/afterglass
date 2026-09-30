const SUPABASE_URL = "https://tqfocdktvjuwoiyfgesb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxZm9jZGt0dmp1d29peWZnZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MDg0NTIsImV4cCI6MjEwNTQ4NDQ1Mn0.8TW4fQCQHc4c_xTNBEwOK3lSC9HYCbkTbfXuYQB-S8g";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const authSheet = $("authSheet");
const authToggle = $("authToggle");
const authForm = $("authForm");
const noteForm = $("noteForm");
let mode = "signin";
let session = null;
let profile = null;

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function tick() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  const left = Math.max(0, next - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $("clock").textContent = `Next house note in ${m}m ${String(s).padStart(2, "0")}s`;
  $("footClock").textContent = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function cardHTML(note, extra = "") {
  const who = note.profiles?.handle || "anon";
  const vis = note.is_public ? "public" : "private";
  return `<article class="card">
    <p>${escapeHtml(note.body)}</p>
    <div class="meta"><span>@${escapeHtml(who)}</span><span class="pill">${vis}</span></div>
    <div class="meta"><time>${fmt(note.created_at)}</time>${extra}</div>
  </article>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function loadHour() {
  const { data } = await sb.from("hour_signals").select("*").order("created_at", { ascending: false }).limit(1);
  const row = data && data[0];
  if (!row) return;
  $("hourTitle").textContent = row.title;
  $("hourBody").textContent = row.body;
  $("hourWhen").textContent = fmt(row.created_at);
}

async function loadWall() {
  const { data } = await sb
    .from("notes")
    .select("id, body, is_public, created_at, profiles(handle)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(40);
  $("wallList").innerHTML = (data || []).map((n) => cardHTML(n)).join("") || "<p class='muted'>Nothing public yet.</p>";
}

async function loadDesk() {
  if (!session) {
    $("deskList").innerHTML = "";
    noteForm.classList.add("hidden");
    $("deskHint").textContent = "Sign in to keep notes and choose what goes public.";
    return;
  }
  noteForm.classList.remove("hidden");
  $("deskHint").textContent = profile ? `Writing as @${profile.handle}` : "Signed in.";
  const { data } = await sb
    .from("notes")
    .select("id, body, is_public, created_at, profiles(handle)")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
  $("deskList").innerHTML = (data || []).map((n) => {
    const btn = `<button class="ghost" data-toggle="${n.id}" data-public="${n.is_public}">${n.is_public ? "Make private" : "Make public"}</button>`;
    return cardHTML(n, btn);
  }).join("") || "<p class='muted'>No notes on this desk yet.</p>";
}

async function ensureProfile() {
  if (!session) return;
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  profile = data;
}

function setAuthUI() {
  if (session) {
    authToggle.textContent = profile ? `@${profile.handle}` : "Account";
    $("authTitle").textContent = "Account";
    authForm.classList.add("hidden");
    $("signOut").classList.remove("hidden");
  } else {
    authToggle.textContent = "Sign in";
    $("authTitle").textContent = mode === "signin" ? "Sign in" : "Create account";
    authForm.classList.remove("hidden");
    $("signOut").classList.add("hidden");
    $("modeFlip").textContent = mode === "signin" ? "Need an account?" : "Have an account?";
    $("handle").closest("label").style.display = mode === "signup" ? "block" : "none";
  }
}

authToggle.onclick = () => { authSheet.hidden = false; };
$("closeSheet").onclick = () => { authSheet.hidden = true; };
authSheet.addEventListener("click", (e) => { if (e.target === authSheet) authSheet.hidden = true; });

$("modeFlip").onclick = () => {
  mode = mode === "signin" ? "signup" : "signin";
  $("authErr").textContent = "";
  setAuthUI();
};

authForm.onsubmit = async (e) => {
  e.preventDefault();
  $("authErr").textContent = "";
  const email = $("email").value.trim();
  const password = $("password").value;
  try {
    if (mode === "signup") {
      const handle = $("handle").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
      if (handle.length < 2) throw new Error("Pick a handle of at least 2 letters.");
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user) {
        const { error: pErr } = await sb.from("profiles").insert({ id: data.user.id, handle });
        if (pErr) throw pErr;
      }
      $("authErr").textContent = "Account created. If email confirm is on, check your inbox.";
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authSheet.hidden = true;
    }
  } catch (err) {
    $("authErr").textContent = err.message || "Could not continue.";
  }
};

$("signOut").onclick = async () => {
  await sb.auth.signOut();
  authSheet.hidden = true;
};

noteForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!session || !profile) return;
  const body = $("noteBody").value.trim();
  if (!body) return;
  const { error } = await sb.from("notes").insert({
    user_id: session.user.id,
    body,
    is_public: $("notePublic").checked
  });
  if (error) {
    alert(error.message);
    return;
  }
  $("noteBody").value = "";
  $("notePublic").checked = false;
  await Promise.all([loadWall(), loadDesk()]);
};

$("deskList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-toggle]");
  if (!btn) return;
  const id = btn.getAttribute("data-toggle");
  const next = btn.getAttribute("data-public") !== "true";
  await sb.from("notes").update({ is_public: next }).eq("id", id);
  await Promise.all([loadWall(), loadDesk()]);
});

document.querySelectorAll("[data-scroll]").forEach((btn) => {
  btn.onclick = () => document.getElementById(btn.dataset.scroll).scrollIntoView({ behavior: "smooth" });
});

sb.auth.onAuthStateChange(async (_event, sess) => {
  session = sess;
  await ensureProfile();
  setAuthUI();
  await loadDesk();
});

tick();
setInterval(tick, 1000);
loadHour();
loadWall();
setInterval(() => { loadHour(); loadWall(); }, 60_000);
