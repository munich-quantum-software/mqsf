const link = document.querySelector("a[data-redirect]");
const target = new URL(location.hash && link.dataset.program ? link.dataset.program : link.href, location.href);
target.search = location.search;
if (location.hash) target.hash = location.hash;
location.replace(target.href);
