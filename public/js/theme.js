/* Theme: saved choice (localStorage "desgro-theme") wins; otherwise follow the OS. Runs before first paint. */
(function(){
  var mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function saved(){ try{ return localStorage.getItem("desgro-theme"); }catch(e){ return null; } }
  function apply(t){ document.documentElement.setAttribute("data-theme", t); }
  apply(saved() || (mq && mq.matches ? "dark" : "light"));
  if(mq && mq.addEventListener) mq.addEventListener("change", function(e){ if(!saved()) apply(e.matches ? "dark" : "light"); });
  window.toggleTheme = function(){
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    apply(next);
    try{ localStorage.setItem("desgro-theme", next); }catch(e){}
  };
})();
