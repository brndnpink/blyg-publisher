// Runs only against a live Blygger reference server, e.g. a local one:
//   (in blygger-spec/worker) npx wrangler d1 migrations apply blyg --local
//   npx wrangler dev --local --port 8787     (with OWNER_PASSWORD in .dev.vars)
//   BLYG_TEST_SERVER=http://127.0.0.1:8787/blyg/ BLYG_TEST_PASSWORD=… npx vitest run test/server.integration.test.ts
// Skipped otherwise, so ordinary test runs and CI never touch a network.

import { describe, expect, it } from "vitest";
import { login, makeServerClient, SessionExpired } from "../src/deploy/server";
import { fetchLive } from "../src/deploy/live";
import { ledgerFromLive } from "../src/remote";

const ORIGIN = process.env.BLYG_TEST_SERVER ?? "";
const PASSWORD = process.env.BLYG_TEST_PASSWORD ?? "";

const get = async (url: string) => {
	const r = await fetch(url);
	return { status: r.status, text: await r.text() };
};
const doc = async (id: string) => JSON.parse((await get(`${ORIGIN}items/${id}.json`)).text);

describe.skipIf(!ORIGIN)("reference server (live)", () => {
	it("rejects a wrong password", async () => {
		await expect(login(ORIGIN, "definitely-wrong")).rejects.toThrow(/Wrong password/);
	});

	it("an invalid session is reported as expired", async () => {
		await expect(makeServerClient(ORIGIN, "blyg_session=1.bad").check()).rejects.toBeInstanceOf(SessionExpired);
	});

	it("publishes, edits, pins, embeds, and withdraws through the owner API", async () => {
		const cookie = await login(ORIGIN, PASSWORD);
		expect(cookie).toMatch(/^blyg_session=/);
		const api = makeServerClient(ORIGIN, cookie);
		await api.check();

		const id = await api.createItem("fragment", "A first *claim*.");
		expect(id).toMatch(/^[0-9a-z]{26}$/);
		expect(await api.publish(id, null)).toBe(1);
		let d = await doc(id);
		expect(d).toMatchObject({ id, kind: "fragment", version: 1, content_md: "A first *claim*." });

		await api.saveText(id, "A sharper *claim*.");
		expect(await api.publish(id, "sharpened")).toBe(2);
		d = await doc(id);
		expect(d.changelog.at(-1)).toMatchObject({ version: 2, note: "sharpened" });

		await api.pin(id, 1);
		expect((await get(`${ORIGIN}items/${id}/v1.json`)).status).toBe(200);

		const th = await api.createItem("thread", `# An essay\n\nIntro.\n\n![[${id}]]\n`);
		expect(await api.publish(th, null)).toBe(1);
		const t = await doc(th);
		expect(t.transclusions).toEqual([{ id, version: 2 }]);
		expect(t.content_html).toContain(`data-blyg-id="${id}"`);

		const bad = await api.createItem("thread", "![[00000000000000000000000000]]");
		await expect(api.publish(bad, null)).rejects.toThrow(/transclusions do not resolve/);

		expect(await api.withdraw(id, "retracted")).toBe(3);
		expect((await doc(id)).kind).toBe("withdrawn");

		const live = await fetchLive(ORIGIN, get);
		expect(live.kind).toBe("live");
		if (live.kind === "live") expect(live.index.map((i) => i.id)).toEqual(expect.arrayContaining([id, th]));
		const view = ledgerFromLive(live);
		expect(view.items[id].versions.at(-1)!.kind).toBe("withdrawn");
		expect(view.items[id].versions.find((v) => v.version === 1)!.pinned).toBe(true);
		expect(view.items[th].authored).toBe("thread");
	});
});
