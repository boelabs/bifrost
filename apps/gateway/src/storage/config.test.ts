import { parseObjectStorage } from "./config.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("an unset url disables storage", () => {
	assert.deepEqual(parseObjectStorage(undefined), { backend: "disabled" });
	assert.deepEqual(parseObjectStorage("  "), { backend: "disabled" });
});

test("file: keeps the path exactly as written, relative or absolute", () => {
	assert.deepEqual(parseObjectStorage("file:.source/object-storage"), {
		backend: "local",
		root: ".source/object-storage",
	});
	assert.deepEqual(parseObjectStorage("file:///var/lib/bifrost"), {
		backend: "local",
		root: "/var/lib/bifrost",
	});
});

test("s3 carries credentials, bucket and endpoint in one string", () => {
	assert.deepEqual(
		parseObjectStorage(
			"s3://key:secret@minio:9000/media?region=eu&pathStyle=true&tls=false",
		),
		{
			backend: "s3",
			bucket: "media",
			region: "eu",
			endpoint: "http://minio:9000",
			accessKeyId: "key",
			secretAccessKey: "secret",
			forcePathStyle: false || true,
		},
	);
});

test("AWS itself needs no endpoint, only a region", () => {
	const config = parseObjectStorage(
		"s3://key:secret@s3.amazonaws.com/media?region=eu-west-1",
	);
	assert.equal(config.backend, "s3");
	assert.equal("endpoint" in config, false);
});

test("a secret with reserved characters survives the round trip", () => {
	const config = parseObjectStorage("s3://key:a%2Fb%40c@host/bucket");
	assert.equal(config.backend === "s3" && config.secretAccessKey, "a/b@c");
});

test("an incomplete url names what is missing rather than failing later", () => {
	assert.throws(() => parseObjectStorage("s3://key:secret@host"), /no bucket/);
	assert.throws(() => parseObjectStorage("s3://host/bucket"), /no credentials/);
	assert.throws(() => parseObjectStorage("file:"), /needs a path/);
	assert.throws(() => parseObjectStorage("postgres://x"), /unknown scheme/);
});
