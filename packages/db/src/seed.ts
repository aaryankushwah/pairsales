/**
 * seed.ts — Idempotent database seed for the GTM agent platform.
 *
 * Creates:
 *  1. A default company ("Your Company", prefix "GTM")
 *  2. CMO agent (openclaw_gateway, 4-hour heartbeat)
 *  3. Blog Writer agent (openclaw_gateway, 1-hour heartbeat)
 *  4. A default project ("Marketing")
 *
 * Safe to run multiple times — checks for existing rows before inserting.
 */

import { eq } from "drizzle-orm";
import { createDb } from "./client.js";
import { companies } from "./schema/companies.js";
import { agents } from "./schema/agents.js";
import { projects } from "./schema/projects.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

const GATEWAY_URL = process.env["OPENCLAW_GATEWAY_URL"] ?? "ws://openclaw:18789";

async function main(): Promise<void> {
  const resolved = await resolveMigrationConnection();
  const db = createDb(resolved.connectionString);

  try {
    // -----------------------------------------------------------------
    // 1. Default company
    // -----------------------------------------------------------------
    let [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.issuePrefix, "GTM"))
      .limit(1);

    if (!company) {
      console.log("[seed] Creating default company...");
      [company] = await db
        .insert(companies)
        .values({
          name: "Your Company",
          description: "Default company created by seed",
          status: "active",
          issuePrefix: "GTM",
          requireBoardApprovalForNewAgents: false,
        })
        .returning();
      console.log(`[seed] Company created: ${company!.id}`);
    } else {
      console.log(`[seed] Company already exists: ${company.id}`);
    }

    const companyId = company!.id;

    // -----------------------------------------------------------------
    // 2. CMO agent
    // -----------------------------------------------------------------
    let [cmoAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.name, "CMO"))
      .limit(1);

    if (!cmoAgent) {
      console.log("[seed] Creating CMO agent...");
      [cmoAgent] = await db
        .insert(agents)
        .values({
          companyId,
          name: "CMO",
          role: "Chief Marketing Officer",
          title: "Chief Marketing Officer",
          status: "idle",
          adapterType: "openclaw_gateway",
          adapterConfig: {
            url: GATEWAY_URL,
            sessionKey: "agent:cmo:main",
            sessionKeyStrategy: "fixed",
            timeoutSec: 300,
          },
          runtimeConfig: {
            heartbeatIntervalMinutes: 240,
          },
          capabilities: "Strategy, campaign planning, task delegation, content review",
        })
        .returning();
      console.log(`[seed] CMO agent created: ${cmoAgent!.id}`);
    } else {
      console.log(`[seed] CMO agent already exists: ${cmoAgent.id}`);
    }

    // -----------------------------------------------------------------
    // 3. Blog Writer agent
    // -----------------------------------------------------------------
    let [blogWriter] = await db
      .select()
      .from(agents)
      .where(eq(agents.name, "Blog Writer"))
      .limit(1);

    if (!blogWriter) {
      console.log("[seed] Creating Blog Writer agent...");
      [blogWriter] = await db
        .insert(agents)
        .values({
          companyId,
          name: "Blog Writer",
          role: "Content Writer",
          title: "Content Writer",
          status: "idle",
          adapterType: "openclaw_gateway",
          adapterConfig: {
            url: GATEWAY_URL,
            sessionKey: "agent:blog-writer:main",
            sessionKeyStrategy: "fixed",
            timeoutSec: 300,
          },
          runtimeConfig: {
            heartbeatIntervalMinutes: 60,
          },
          reportsTo: cmoAgent!.id,
          capabilities: "Blog writing, research, SEO content, long-form articles",
        })
        .returning();
      console.log(`[seed] Blog Writer agent created: ${blogWriter!.id}`);
    } else {
      console.log(`[seed] Blog Writer agent already exists: ${blogWriter.id}`);
    }

    // -----------------------------------------------------------------
    // 4. Default project
    // -----------------------------------------------------------------
    let [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.name, "Marketing"))
      .limit(1);

    if (!project) {
      console.log("[seed] Creating Marketing project...");
      [project] = await db
        .insert(projects)
        .values({
          companyId,
          name: "Marketing",
          description: "Default marketing project for GTM agents",
          status: "active",
          leadAgentId: cmoAgent!.id,
        })
        .returning();
      console.log(`[seed] Marketing project created: ${project!.id}`);
    } else {
      console.log(`[seed] Marketing project already exists: ${project.id}`);
    }

    console.log("[seed] Seed complete.");
  } finally {
    await resolved.stop();
  }
}

await main();
process.exit(0);
