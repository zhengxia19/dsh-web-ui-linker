/**
 * dsh-web-ui-linker
 *
 * One job: every dsh boot, ask this instance's own `connection` service for its
 * browser-authenticated Web UI link (`connection.authenticatedUrl(cleanBaseUrl)`)
 * and write it to fixed files, overwriting the previous content.
 *
 * It reads only: it registers no routes, touches no authentication, and calls
 * nothing that could restart or interrupt the instance.
 *
 * Lifecycle note: shipped host plugins never subscribe to a `ready` event, and
 * the listener binds its port during application start rather than during plugin
 * apply. So the write is driven by a plain poll loop: wait until `webServer.port`
 * resolves, write the link as soon as it is available, then keep the file fresh
 * for a short while in case the port changes.
 *
 * @module dsh-web-ui-linker
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable Cordis plugin name. */
export const name = "dsh-web-ui-linker";

/** Services required before the link can be read. */
export const inject = ["connection", "webServer"];

/** Package directory: the output lives with the plugin, next to its source. */
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the link is written (overwritten on every boot). */
const LINK_FILES = [join(packageDir, "web-ui-url.txt")];

/** Diagnostics trail, so a failure is distinguishable from an unmounted plugin. */
const STATUS_FILES = [join(packageDir, "web-ui-url.status.txt")];

/** Poll cadence and horizon for resolving the listening port. */
const FAST_INTERVAL_MS = 400;
const FAST_ATTEMPTS = 75;
const KEEP_INTERVAL_MS = 10_000;
const KEEP_ATTEMPTS = 12;

/** Write the same text to every path, collecting per-path failures. */
function writeAll(files, text) {
	const errors = [];
	for (const file of files) {
		try {
			writeFileSync(file, text, "utf8");
		} catch (error) {
			errors.push(`${file}: ${String(error?.message ?? error)}`);
		}
	}
	return errors;
}

/** Load-time marker: proves the module was mounted even if apply() never runs. */
writeAll(STATUS_FILES, [
	`# dsh-web-ui-linker module evaluated pid ${process.pid}`,
	`${new Date().toISOString()} module evaluated; apply() not called yet`,
].join("\n") + "\n");

/** @param {any} ctx plugin context carrying the `connection` and `webServer` services. */
export async function apply(ctx) {
	const log = [];
	const note = (message) => {
		log.push(`${new Date().toISOString()} ${message}`);
		writeAll(STATUS_FILES, [`# dsh-web-ui-linker pid ${process.pid}`, ...log.slice(-40)].join("\n") + "\n");
	};
	note(`apply() entered; node ${process.version}`);
	note(`services: connection=${typeof ctx.connection} webServer=${typeof ctx.get("webServer")}`);
	let written;
	let lastError;
	for (let attempt = 0; attempt < FAST_ATTEMPTS + KEEP_ATTEMPTS; attempt += 1) {
		try {
			const server = ctx.get("webServer");
			const port = Number(server?.port ?? 0);
			if (!port) throw new Error("webServer port not bound yet");
			const base = `${server.protocol}//127.0.0.1:${String(port)}`;
			const url = ctx.connection.authenticatedUrl(base);
			const clean = url.replace(/[?&]token=[^&]*/, "");
			if (written !== url) {
				const text = `${url}\n\n# written ${new Date().toISOString()} by pid ${process.pid}\n# plugin dsh-web-ui-linker; clean origin: ${clean}\n`;
				const errors = writeAll(LINK_FILES, text);
				written = url;
				note(`wrote link (clean origin ${clean})${errors.length ? `; write errors: ${errors.join("; ")}` : ""}`);
			}
		} catch (error) {
			lastError = error;
			if (attempt % 25 === 0) note(`attempt ${attempt}: ${String(error?.message ?? error)}`);
		}
		if (attempt >= FAST_ATTEMPTS && written !== undefined && attempt >= FAST_ATTEMPTS + 3) break;
		await new Promise((resolve) => setTimeout(resolve, attempt >= FAST_ATTEMPTS ? KEEP_INTERVAL_MS : FAST_INTERVAL_MS));
	}
	note(`finished; lastError=${String(lastError?.message ?? lastError ?? "none")}`);
}
