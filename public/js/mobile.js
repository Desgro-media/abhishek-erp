// Mobile-only behaviour: the slide-in navigation drawer. Does nothing on desktop (the hamburger is
// hidden there, and every handler bails out above the drawer breakpoint). Touches no app state.
(function(){
  var BREAKPOINT = 1040;
  var btn = document.getElementById("mobile-menu-btn");
  var backdrop = document.getElementById("side-backdrop");
  var side = document.querySelector(".side");
  var navEl = document.getElementById("main-nav");
  if(!btn || !backdrop || !side || !navEl) return;

  var isDrawer = function(){ return window.innerWidth <= BREAKPOINT; };
  function setOpen(open){
    document.body.classList.toggle("nav-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if(open){ var first = navEl.querySelector(".nav-item.active, .nav-item"); if(first) first.focus({preventScroll:true}); }
  }
  btn.addEventListener("click", function(){ setOpen(!document.body.classList.contains("nav-open")); });
  backdrop.addEventListener("click", function(){ setOpen(false); });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && document.body.classList.contains("nav-open")){ setOpen(false); btn.focus(); }
  });
  // Close on route change: picking a page (a sub-item, or Dashboard, which has none). Tapping a module
  // header only expands its sections, so the drawer stays open for that.
  navEl.addEventListener("click", function(e){
    if(!isDrawer()) return;
    var el = e.target.closest(".sub-item, .nav-item"); if(!el) return;
    var go = el.getAttribute("onclick") || "";
    if(el.classList.contains("sub-item") || go.indexOf("setSub(") !== -1 || go.indexOf("setModule('dashboard')") !== -1) setOpen(false);
  });
  // Leaving drawer mode (rotate / resize to desktop) must never leave the page scroll-locked.
  window.addEventListener("resize", function(){ if(!isDrawer() && document.body.classList.contains("nav-open")) setOpen(false); });
})();
