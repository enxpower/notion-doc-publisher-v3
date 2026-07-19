import fs from "node:fs/promises";
import path from "node:path";
import { UserFacingError } from "../config.js";
import { normalizeBrand, type BrandRoute } from "./brand-routing.js";

type RawRoute = {
  brand?: unknown;
  targetRepository?: unknown;
  targetDomain?: unknown;
  cname?: unknown;
  routeId?: unknown;
  presentationProfileKey?: unknown;
  allowedUrlNamespaces?: unknown;
  repositoryConfirmed?: unknown;
  allowSharedTarget?: unknown;
  blockedReason?: unknown;
};

const REQUIRED_ROUTE_BRANDS = ["ARCBOS", "ENERGIZE", "AGIM", "GONG"] as const;
const DEFAULT_ROUTE_CONFIG_PATH = "config/brand-routes.json";
const SUPPORTED_ROUTE_NAMESPACES = new Set(["docs", "clients", "partners", "internal"]);

export async function loadBrandRoutes(configPath = DEFAULT_ROUTE_CONFIG_PATH): Promise<BrandRoute[]> {
  const raw = JSON.parse(await fs.readFile(path.resolve(configPath), "utf8")) as Record<string, RawRoute>;
  const keys = Object.keys(raw).map(normalizeBrand).sort();
  const expected = [...REQUIRED_ROUTE_BRANDS].sort();
  if (keys.join(",") !== expected.join(",")) {
    throw new UserFacingError(`Brand route config must contain exactly: ${expected.join(", ")}.`);
  }

  const routes = REQUIRED_ROUTE_BRANDS.map((brand) => parseRoute(brand, raw[brand]));
  validateUniqueRouteFields(routes);
  return routes;
}

export function defaultRouteOutputRoot(brand: string): string {
  return path.join("dist", "routes", normalizeBrand(brand), "site");
}

export function routeWithOutputRoot(route: BrandRoute, outputBaseRoot: string): BrandRoute {
  return {
    ...route,
    outputRoot: path.join(outputBaseRoot, normalizeBrand(route.brand), "site")
  };
}

export function routesWithOutputBase(routes: BrandRoute[], outputBaseRoot: string): BrandRoute[] {
  return routes.map((route) => routeWithOutputRoot(route, outputBaseRoot));
}

function parseRoute(brand: string, raw: RawRoute | undefined): BrandRoute {
  if (!raw || typeof raw !== "object") {
    throw new UserFacingError(`Missing route for ${brand}.`);
  }
  const normalizedBrand = normalizeBrand(stringField(raw.brand, `${brand}.brand`));
  if (normalizedBrand !== brand) {
    throw new UserFacingError(`${brand}.brand must normalize to ${brand}.`);
  }
  const targetRepository = nullableStringField(raw.targetRepository, `${brand}.targetRepository`);
  const targetDomain = parseTargetDomain(stringField(raw.targetDomain, `${brand}.targetDomain`), `${brand}.targetDomain`);
  const allowedUrlNamespaces = stringArrayField(raw.allowedUrlNamespaces, `${brand}.allowedUrlNamespaces`);
  if (allowedUrlNamespaces.length === 0) {
    throw new UserFacingError(`${brand}.allowedUrlNamespaces must not be empty.`);
  }
  for (const namespace of allowedUrlNamespaces) {
    if (!SUPPORTED_ROUTE_NAMESPACES.has(namespace)) {
      throw new UserFacingError(`${brand}.allowedUrlNamespaces contains unsupported namespace: ${namespace}.`);
    }
  }
  const cname = stringField(raw.cname, `${brand}.cname`);
  if (new URL(targetDomain).hostname !== cname) {
    throw new UserFacingError(`${brand}.cname must match ${brand}.targetDomain hostname.`);
  }
  return {
    brand,
    routeId: stringField(raw.routeId, `${brand}.routeId`),
    outputRoot: defaultRouteOutputRoot(brand),
    targetRepository,
    targetDomain,
    cname,
    presentationProfileKey: presentationProfileKeyField(raw.presentationProfileKey, `${brand}.presentationProfileKey`, brand),
    allowedUrlNamespaces,
    repositoryConfirmed: raw.repositoryConfirmed === true,
    allowSharedTarget: raw.allowSharedTarget === true,
    blockedReason: typeof raw.blockedReason === "string" ? raw.blockedReason.trim() : undefined
  };
}

function validateUniqueRouteFields(routes: BrandRoute[]): void {
  assertUnique(routes.map((route) => route.routeId ?? ""), "route identifier");
  assertUnique(routes.map((route) => path.resolve(route.outputRoot)), "output root");

  const targetKeys = routes
    .filter((route) => !route.allowSharedTarget && route.targetRepository)
    .map((route) => `${route.targetRepository}|${route.targetDomain.toLowerCase()}`);
  assertUnique(targetKeys, "target repository/domain combination");
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new UserFacingError(`Duplicate ${label} is not allowed: ${value}.`);
    }
    seen.add(value);
  }
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserFacingError(`Brand route field ${name} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableStringField(value: unknown, name: string): string | null {
  if (value === null) {
    return null;
  }
  return stringField(value, name);
}

function presentationProfileKeyField(value: unknown, name: string, brand: string): string | null {
  const profileKey = nullableStringField(value, name);
  if (profileKey === null && brand !== "GONG") {
    throw new UserFacingError(`Brand route field ${name} must be a non-empty string.`);
  }
  if (brand === "GONG" && profileKey !== null) {
    throw new UserFacingError("GONG presentation profile is unconfirmed and must remain null.");
  }
  return profileKey;
}

function stringArrayField(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new UserFacingError(`Brand route field ${name} must be an array.`);
  }
  const strings = value.map((item) => stringField(item, name));
  return [...new Set(strings)];
}

function parseTargetDomain(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    return value.replace(/\/+$/, "");
  } catch {
    throw new UserFacingError(`Brand route field ${name} must be an https origin URL.`);
  }
}
