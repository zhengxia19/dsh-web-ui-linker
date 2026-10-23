/**
 * Unit tests for the /web-ui-linker/url route handler.
 * Run: node --test test/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createUrlHandler, readCurrent, ROUTE_PATH } from "../lib/index.js";

function makeCtx({ port = 57999, admit } = {}) {
	return {
		get: (id) => (id === "webServer" ? { port, protocol: "http:" } : undefined),
		connection: {
			authenticatedUrl: (base) => `${base}/?token=tok-123`,
			...(admit === undefined ? {} : { admit }),
		},
	};
}

function makeRes() {
	const res = { status: 0, headers: {}, body: "" };
	res.writeHead = (status, headers) => {
		res.status = status;
		Object.assign(res.headers, headers ?? {});
	};
	res.end = (chunk) => {
		res.body = chunk ?? "";
	};
	return res;
}

test("route path is the documented exact path", () => {
	assert.equal(ROUTE_PATH, "/web-ui-linker/url");
});

test("GET returns the fresh reading with token, clean, and origin", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }));
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 200);
	assert.equal(res.headers["cache-control"], "no-store");
	const data = JSON.parse(res.body);
	assert.equal(data.url, "http://127.0.0.1:57999/?token=tok-123");
	assert.equal(data.clean, "http://127.0.0.1:57999/");
	assert.equal(data.token, "tok-123");
	assert.equal(data.origin, "http://127.0.0.1:57999");
	assert.ok(!Number.isNaN(Date.parse(data.generatedAt)));
});

test("HEAD is accepted like GET", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }));
	const res = makeRes();
	handler({ method: "HEAD" }, res);
	assert.equal(res.status, 200);
});

test("POST is rejected with 405 before any auth", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }));
	const res = makeRes();
	handler({ method: "POST" }, res);
	assert.equal(res.status, 405);
	assert.ok(!res.body.includes("tok-123"));
});

test("unauthenticated request gets 401 and no token in body", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ rejection: 401 }) }));
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 401);
	assert.equal(res.body, "unauthorized");
	assert.ok(!res.body.includes("tok-123"));
});

test("untrusted host gets 403", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ rejection: 403 }) }));
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 403);
	assert.equal(res.body, "forbidden");
});

test("missing port answers 503 JSON without leaking anything", () => {
	const handler = createUrlHandler(makeCtx({ port: 0, admit: () => ({ peer: {} }) }));
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 503);
	assert.deepEqual(JSON.parse(res.body), { error: "web-server-not-ready" });
});

test("carriers without admit still serve (defensive fallback)", () => {
	const handler = createUrlHandler(makeCtx({})); // no admit on connection
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 200);
});

test("readCurrent returns null before the port binds and a reading after", () => {
	assert.equal(readCurrent(makeCtx({ port: 0 })), null);
	const reading = readCurrent(makeCtx({ port: 57120 }));
	assert.equal(reading.url, "http://127.0.0.1:57120/?token=tok-123");
});

test("handler answers live: a later reading reflects the current port/token", () => {
	const ctx = makeCtx({ admit: () => ({ peer: {} }) });
	let token = "tok-a";
	ctx.connection.authenticatedUrl = (base) => `${base}/?token=${token}`;
	const handler = createUrlHandler(ctx);
	const first = makeRes();
	handler({ method: "GET" }, first);
	assert.ok(first.body.includes("tok-a"));
	token = "tok-b";
	const second = makeRes();
	handler({ method: "GET" }, second);
	assert.ok(second.body.includes("tok-b"));
	assert.ok(!second.body.includes("tok-a"));
});

test("onServe observer sees the answered status codes", () => {
	const seen = [];
	const ok = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }), (status) => seen.push(status));
	ok({ method: "GET" }, makeRes());
	const denied = createUrlHandler(makeCtx({ admit: () => ({ rejection: 401 }) }), (status) => seen.push(status));
	denied({ method: "GET" }, makeRes());
	assert.deepEqual(seen, [200, 401]);
});

test("onServe throwing does not break the response", () => {
	const handler = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }), () => {
		throw new Error("diagnostics must never break serving");
	});
	const res = makeRes();
	handler({ method: "GET" }, res);
	assert.equal(res.status, 200);
});

test("onServe receives the src tag when present", () => {
	const seen = [];
	const handler = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }), (status, src) => seen.push([status, src]));
	handler({ method: "GET", url: "/web-ui-linker/url?src=click" }, makeRes());
	handler({ method: "GET", url: "/web-ui-linker/url" }, makeRes());
	assert.deepEqual(seen, [[200, "click"], [200, undefined]]);
});

test("authenticated ?probe= reaches onProbe; rejected requests never probe", () => {
	const probes = [];
	const ok = createUrlHandler(makeCtx({ admit: () => ({ peer: {} }) }), undefined, (p) => probes.push(p));
	ok({ method: "GET", url: "/web-ui-linker/url?probe=dir%3Drow%20kids%3D2" }, makeRes());
	assert.deepEqual(probes, ["dir=row kids=2"]);
	const denied = createUrlHandler(makeCtx({ admit: () => ({ rejection: 401 }) }), undefined, (p) => probes.push(p));
	denied({ method: "GET", url: "/web-ui-linker/url?probe=secret" }, makeRes());
	assert.equal(probes.length, 1); // only the earlier ok probe
});
