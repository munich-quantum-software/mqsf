import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const destination = process.argv[2];
if (!destination)
  throw new Error(
    "Usage: node .github/scripts/package-site.mjs OUTPUT [--preview]",
  );
const preview = process.argv.includes("--preview");
mkdirSync(destination); // Require a fresh directory; never overwrite an existing site.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((path) =>
    /^(?:index\.html$|\d{4}\/|assets\/|background\/|logos\/)/.test(path),
  );
for (const path of files) {
  if (!lstatSync(path).isFile())
    throw new Error(`Only regular public files may be published: ${path}`);
  const target = resolve(destination, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(path, target);
  if (preview && /^\d{4}\/meetups\/config\.js$/.test(path)) {
    writeFileSync(target, "window.MQSF_PREVIEW = true;\n");
  }
  if (preview && path.endsWith(".html")) {
    writeFileSync(
      target,
      readFileSync(target, "utf8")
        .replace(
          /<head>/i,
          '<head>\n    <meta name="robots" content="noindex, nofollow">',
        )
        .replace(
          /Local preview · These example meet-ups are for trying out the\s+calendar, not confirmed meet-ups\./,
          "PR preview · Read-only calendar. No live meet-up data is loaded or changed.",
        ),
    );
  }
}
if (!preview) writeFileSync(resolve(destination, ".nojekyll"), "");
