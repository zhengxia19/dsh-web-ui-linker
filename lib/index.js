/**
 * dsh-web-ui-linker
 *
 * Two jobs, one shared reading:
 *
 * 1. Every dsh boot, ask this instance's own `connection` service for its
 *    browser-authenticated Web UI link (`connection.authenticatedUrl(cleanBaseUrl)`)
 *    and write it to fixed files, overwriting the previous content.
 * 2. Serve `GET /web-ui-linker/url` (exact webServer route) returning the SAME
 *    reading as JSON, recomputed live on every request, so the browser-half
 *    button can open a token-bearing URL on click without ever caching one.
 *
 * The route answers only to requests that pass `connection.admit`: the webServer
 * itself has no global authentication, and this route hands out the launch token,
 * so an unauthenticated local process must not read it. Browser pages carry the
 * signed host-only cookie automatically, which is what the button's same-origin
 * `fetch` relies on.
 *
 * Lifecycle note: Cordis activates this plugin after its injected services are
 * ready. WebServer initialization awaits its bound port, so write the link once
 * per activation without polling. A dependency reload reactivates this plugin;
 * HTTP requests always compute the reading from the current services.
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

/** Exact webServer path answering the browser-half button. */
export const ROUTE_PATH = "/web-ui-linker/url";

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

/**
 * Compute this instance's live browser-authenticated reading.
 *
 * Fresh on every call: the launch token is per-process and the port may move,
 * so neither the button nor the file writer ever reuses a stale reading.
 *
 * @param {any} ctx context carrying the `connection` and `webServer` services.
 * @returns the reading, or null while the web listener has not bound a port.
 */
export function readCurrent(ctx) {
	const server = ctx.get("webServer");
	const port = Number(server?.port ?? 0);
	if (!port) return null;
	const base = `${server.protocol}//127.0.0.1:${String(port)}`;
	const url = ctx.connection.authenticatedUrl(base);
	const clean = url.replace(/[?&]token=[^&]*/, "");
	const token = new URL(url).searchParams.get("token") ?? "";
	return { url, clean, token, origin: base, generatedAt: new Date().toISOString() };
}

/**
 * Build the `/web-ui-linker/url` route handler.
 *
 * Gate order matches the platform's own routes: method check, then
 * `connection.admit` (Host/Origin trust plus cookie/API authentication),
 * then the live reading. Rejections carry no body content beyond the status
 * text, so a probing local process cannot read the token.
 *
 * @param {any} ctx context carrying the `connection` and `webServer` services.
 * @param {((status: number) => void) | undefined} [onServe] optional observer of
 * every answered request, used by apply() to leave a throttled trace in the
 * status file (decides whether a button click ever reached the route).
 * @param {((probe: string) => void) | undefined} [onProbe] optional observer of
 * authenticated `?probe=` requests — one-line DOM diagnostics from the button.
 * @returns a (req, res) handler compatible with `webServer.register`.
 */
export function createUrlHandler(ctx, onServe, onProbe) {
	const answer = (status, headers, body, req, res) => {
		if (typeof onServe === "function") {
			let src;
			try {
				src = new URL(req.url ?? "", "http://localhost").searchParams.get("src") ?? undefined;
			} catch { src = undefined; }
			try {
				onServe(status, src !== undefined ? String(src).slice(0, 24) : undefined);
			} catch { /* diagnostics never break the response */ }
		}
		res.writeHead(status, headers);
		res.end(body);
	};
	return (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			answer(405, { "content-type": "text/plain; charset=utf-8" }, "method not allowed", req, res);
			return;
		}
		if (typeof ctx.connection.admit === "function") {
			const admission = ctx.connection.admit(req);
			if ("rejection" in admission) {
				answer(admission.rejection, { "content-type": "text/plain; charset=utf-8" }, admission.rejection === 401 ? "unauthorized" : "forbidden", req, res);
				return;
			}
		}
		let probe;
		try {
			probe = new URL(req.url ?? "", "http://localhost").searchParams.get("probe") ?? undefined;
		} catch { probe = undefined; }
		const reading = readCurrent(ctx);
		if (reading === null) {
			answer(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, JSON.stringify({ error: "web-server-not-ready" }), req, res);
		} else {
			answer(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, JSON.stringify(reading), req, res);
		}
		if (probe !== undefined && typeof onProbe === "function") {
			try {
				onProbe(String(probe).replace(/\s+/g, " ").slice(0, 600));
			} catch { /* diagnostics never break serving */ }
		}
	};
}

/** @param {any} ctx plugin context carrying the `connection` and `webServer` services. */
export function apply(ctx) {
	const log = [];
	const note = (message) => {
		log.push(`${new Date().toISOString()} ${message}`);
		writeAll(STATUS_FILES, [`# dsh-web-ui-linker pid ${process.pid}`, ...log.slice(-40)].join("\n") + "\n");
	};
	note(`apply() entered; node ${process.version}`);
	note(`services: connection=${typeof ctx.connection} webServer=${typeof ctx.get("webServer")}`);
	ctx.effect(() => {
		let lastTrace = 0;
		const trace = (status, src) => {
			const now = Date.now();
			if (now - lastTrace < 2000) return;
			lastTrace = now;
			note(`route answered ${String(status)}${typeof src === "string" ? ` src:${src}` : ""}`);
		};
		let lastProbe = 0;
		const probeTrace = (text) => {
			const now = Date.now();
			if (now - lastProbe < 10_000) return;
			lastProbe = now;
			note(`probe ${text}`);
		};
		const dispose = ctx.webServer.register({
			kind: "exact",
			path: ROUTE_PATH,
			handler: createUrlHandler(ctx, trace, probeTrace),
		});
		note(`route registered: GET ${ROUTE_PATH}`);
		return () => {
			if (typeof dispose === "function") dispose();
			note(`route disposed: ${ROUTE_PATH}`);
		};
	}, "web-ui-linker:url-route");
	try {
		const reading = readCurrent(ctx);
		if (reading === null) throw new Error("webServer port not bound yet");
		const text = `${reading.url}\n\n# written ${new Date().toISOString()} by pid ${process.pid}\n# plugin dsh-web-ui-linker; clean origin: ${reading.clean}\n`;
		const errors = writeAll(LINK_FILES, text);
		note(`wrote link (clean origin ${reading.clean})${errors.length ? `; write errors: ${errors.join("; ")}` : ""}`);
	} catch (error) {
		note(`link write failed: ${String(error?.message ?? error)}`);
	}
}
