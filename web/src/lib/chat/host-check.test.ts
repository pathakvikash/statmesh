import { describe, expect, it } from "vitest";
import { checkBaseUrl, classifyIp } from "./host-check";

const dns = (...addr: string[]) => async () => addr.map((address) => ({ address }));
const self = { hosted: false };
const hosted = { hosted: true };

describe("classifyIp", () => {
  it("classifies IPv4", () => {
    for (const ip of ["169.254.169.254", "169.254.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "100.100.100.200"]) expect(classifyIp(ip)).toBe("blocked");
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1"]) expect(classifyIp(ip)).toBe("local");
    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1"]) expect(classifyIp(ip)).toBe("public");
  });
  it("classifies IPv6, including IPv4-mapped forms", () => {
    for (const ip of ["fe80::1", "febf::1", "ff02::1", "::", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "fd00:ec2::254"]) expect(classifyIp(ip)).toBe("blocked");
    for (const ip of ["::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) expect(classifyIp(ip)).toBe("local");
    for (const ip of ["2606:4700::1111", "::ffff:8.8.8.8", "2001:db8::1"]) expect(classifyIp(ip)).toBe("public");
  });
});

describe("checkBaseUrl", () => {
  it("rejects metadata and link-local literals in every mode, without echoing the address", async () => {
    for (const o of [self, hosted]) {
      for (const u of ["http://169.254.169.254/latest", "http://[fe80::1]/v1", "http://0.0.0.0:80/v1", "http://[::ffff:169.254.169.254]/v1", "http://metadata.google.internal/v1"]) {
        const e = await checkBaseUrl(u, { ...o, lookup: dns("8.8.8.8") });
        expect(e).toBeTruthy();
        expect(e).not.toMatch(/\d+\.\d+/);
      }
    }
  });
  it("allows loopback and private hosts in self-host only", async () => {
    expect(await checkBaseUrl("http://localhost:11434/v1", { ...self, lookup: dns("127.0.0.1") })).toBeNull();
    expect(await checkBaseUrl("http://[::1]:11434/v1", self)).toBeNull();
    expect(await checkBaseUrl("http://192.168.1.5/v1", self)).toBeNull();
    expect(await checkBaseUrl("http://localhost:11434/v1", { ...hosted, lookup: dns("127.0.0.1") })).toBeTruthy();
    expect(await checkBaseUrl("http://10.0.0.5/v1", hosted)).toBeTruthy();
  });
  it("checks every DNS answer, so a public name with a link-local record is rejected", async () => {
    expect(await checkBaseUrl("https://llm.example/v1", { ...self, lookup: dns("8.8.8.8", "169.254.169.254") })).toBeTruthy();
    expect(await checkBaseUrl("https://llm.example/v1", { ...self, lookup: dns("8.8.8.8", "2606:4700::1111") })).toBeNull();
    expect(await checkBaseUrl("https://llm.example/v1", { ...hosted, lookup: dns("8.8.8.8", "192.168.0.1") })).toBeTruthy();
  });
  it("fails closed when DNS fails or returns nothing", async () => {
    expect(await checkBaseUrl("https://nx.example/v1", { lookup: async () => { throw new Error("ENOTFOUND"); } })).toBeTruthy();
    expect(await checkBaseUrl("https://nx.example/v1", { lookup: dns() })).toBeTruthy();
  });
});
