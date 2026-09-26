(() => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme ---------- */
  const storedTheme = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = storedTheme || (prefersDark ? "dark" : "light");

  document.querySelector(".theme-toggle").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage unavailable */ }
  });

  /* ---------- Mobile nav ---------- */
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.getElementById("nav-links");
  const closeNav = () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  };
  navToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.querySelectorAll("a").forEach((a) => a.addEventListener("click", closeNav));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });

  /* ---------- Header border + active link ---------- */
  const header = document.querySelector(".site-header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const navAnchors = [...navLinks.querySelectorAll('a[href^="#"]:not(.btn)')];
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navAnchors.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navAnchors.forEach((a) => {
    const section = document.querySelector(a.getAttribute("href"));
    if (section) sectionObserver.observe(section);
  });

  /* ---------- Reveal on scroll ---------- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    revealObserver.observe(el);
  });

  /* ---------- Animated counters ---------- */
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const suffix = el.dataset.suffix || "";
    const format = (n) => n.toFixed(decimals) + suffix;
    if (reduceMotion) { el.textContent = format(target); return; }
    const duration = 1600;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll("[data-count]").forEach((el) => countObserver.observe(el));

  /* ---------- Typing terminal ---------- */
  const terminal = document.getElementById("typed-terminal");
  const lines = [
    { html: '<span class="p">$</span> ', type: "npm i -g @voltic/cli" },
    { html: '<span class="dim">added 1 package in 1.2s</span>' },
    { html: '<span class="p">$</span> ', type: "voltic deploy --prod" },
    { html: '<span class="dim">› Detected framework: Next.js</span>' },
    { html: '<span class="ok">✓</span> Built in 14.2s' },
    { html: '<span class="ok">✓</span> Tests passed (128/128)' },
    { html: '<span class="ok">✓</span> Deployed to 40 regions' },
    { html: "" },
    { html: '🚀 Live at <span class="url">https://my-app.voltic.app</span>' },
  ];
  const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  if (reduceMotion) {
    terminal.innerHTML = lines.map((l) => l.html + (l.type ? escapeHtml(l.type) : "")).join("\n");
  } else {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = async () => {
      let done = "";
      for (const line of lines) {
        if (line.type) {
          for (let i = 1; i <= line.type.length; i++) {
            terminal.innerHTML = done + line.html + escapeHtml(line.type.slice(0, i));
            await wait(45 + Math.random() * 45);
          }
          done += line.html + escapeHtml(line.type) + "\n";
          await wait(450);
        } else {
          done += line.html + "\n";
          terminal.innerHTML = done;
          await wait(320);
        }
      }
    };
    run();
  }

  /* ---------- Tabs (WAI-ARIA pattern) ---------- */
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selectTab = (tab) => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
    });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === "Home") next = tabs[0];
      if (e.key === "End") next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); selectTab(next); next.focus(); }
    });
  });

  /* ---------- Pricing toggle ---------- */
  document.querySelectorAll("[data-billing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.dataset.billing;
      document.querySelectorAll("[data-billing]").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll(".amount[data-monthly]").forEach((el) => {
        el.textContent = `$${el.dataset[period]}`;
      });
    });
  });

  /* ---------- Copy code ---------- */
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.getElementById(btn.dataset.copyTarget).innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied!";
      } catch {
        btn.textContent = "Press Ctrl+C";
      }
      setTimeout(() => { btn.textContent = "Copy"; }, 1800);
    });
  });

  /* ---------- Contact form ---------- */
  const form = document.querySelector(".contact-form");
  const status = form.querySelector(".form-status");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = form.elements.name;
    const email = form.elements.email;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    name.setAttribute("aria-invalid", String(!name.value.trim()));
    email.setAttribute("aria-invalid", String(!emailOk));

    if (!name.value.trim() || !emailOk) {
      status.className = "form-status error";
      status.textContent = "Please enter your name and a valid email address.";
      (!name.value.trim() ? name : email).focus();
      return;
    }
    status.className = "form-status success";
    status.textContent = `Thanks, ${name.value.trim().split(" ")[0]}! We'll be in touch shortly.`;
    form.reset();
  });

  /* ---------- Footer year ---------- */
  document.getElementById("year").textContent = new Date().getFullYear();
})();
