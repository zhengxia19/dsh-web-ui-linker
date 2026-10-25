import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "dsh-web-ui-linker-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "lib"));
	const entry = join(root, "lib", "index.mjs");
	copyFileSync(new URL("../lib/index.js", import.meta.url), entry);
	const plugin = await import(pathToFileURL(entry).href);
	const routes = new Map();
	const disposers = [];
	const server = {
		port: 57999,
		protocol: "http:",
		register(route) {
			routes.set(route.path, route.handler);
			return () => routes.delete(route.path);
		},
	};
	const ctx = {
		webServer: server,
		get: (name) => name === "webServer" ? server : undefined,
		connection: { authenticatedUrl: (base) => `${base}/?token=test-token` },
		effect(callback) { disposers.push(callback()); },
	};
	return { root, plugin, ctx, routes, dispose: () => disposers.splice(0).reverse().forEach(fn => fn()) };
}

// Execute the real apply() while making the former minute-long loop fast and observable.
async function activateWithoutPolling(f) {
	const original = globalThis.setTimeout;
	const delays = [];
	globalThis.setTimeout = (callback, delay) => {
		delays.push(delay);
		queueMicrotask(callback);
		return {};
	};
	try {
		await f.plugin.apply(f.ctx);
	} finally {
		globalThis.setTimeout = original;
	}
	assert.equal(delays.length, 0, `startup scheduled ${delays.length} polling timers`);
}

function response() {
	return {
		writeHead(status) { this.status = status; },
		end(body) { this.body = body; },
	};
}

test("ready services write the link without polling and dispose the route", async t => {
	const f = await fixture(t);
	await activateWithoutPolling(f);
	assert.match(readFileSync(join(f.root, "web-ui-url.txt"), "utf8"), /^http:\/\/127\.0\.0\.1:57999\/\?token=test-token\n/);
	assert.equal(f.routes.size, 1);
	f.dispose();
	assert.equal(f.routes.size, 0);
});

test("reactivation writes the new service port without polling", async t => {
	const f = await fixture(t);
	await activateWithoutPolling(f);
	f.dispose();
	f.ctx.webServer.port = 58000;
	await activateWithoutPolling(f);
	assert.match(readFileSync(join(f.root, "web-ui-url.txt"), "utf8"), /^http:\/\/127\.0\.0\.1:58000\//);
	assert.equal(f.routes.size, 1);
	f.dispose();
});

test("an unavailable port is diagnosed without waiting and the route remains live", async t => {
	const f = await fixture(t);
	f.ctx.webServer.port = undefined;
	await activateWithoutPolling(f);
	assert.match(readFileSync(join(f.root, "web-ui-url.status.txt"), "utf8"), /webServer port not bound yet/);
	const res = response();
	f.routes.get(f.plugin.ROUTE_PATH)({ method: "GET" }, res);
	assert.equal(res.status, 503);
	f.ctx.webServer.port = 58001;
	f.routes.get(f.plugin.ROUTE_PATH)({ method: "GET" }, res);
	assert.equal(res.status, 200);
	assert.equal(JSON.parse(res.body).origin, "http://127.0.0.1:58001");
	f.dispose();
});

test("a link-file write failure does not block startup or disable the route", async t => {
	const f = await fixture(t);
	mkdirSync(join(f.root, "web-ui-url.txt"));
	await activateWithoutPolling(f);
	assert.match(readFileSync(join(f.root, "web-ui-url.status.txt"), "utf8"), /write errors:/);
	const res = response();
	f.routes.get(f.plugin.ROUTE_PATH)({ method: "GET" }, res);
	assert.equal(res.status, 200);
	f.dispose();
});
