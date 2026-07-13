import type { TopoDoc } from "@topox/core";
import { applyDiff, emptyDoc } from "@topox/core";

/** Demo topology: a small ISP edge deployment. */
export function demoDoc(): TopoDoc {
  const doc = emptyDoc("demo", "Edge Deployment");
  return applyDiff(doc, {
    origin: "seed",
    summary: "seed demo topology",
    ops: [
      { op: "add_node", node: { id: "internet", type: "net-cloud", label: "Internet" } },
      { op: "add_node", node: { id: "fw", type: "net-firewall", label: "Firewall", tags: ["hq"] } },
      { op: "add_node", node: { id: "r1", type: "net-mikrotik", label: "MikroTik HQ", ref: "ros:hq-01", tags: ["hq"] } },
      { op: "add_node", node: { id: "sw1", type: "net-switch", label: "Core Switch", tags: ["hq"] } },
      { op: "add_node", node: { id: "acs", type: "net-server", label: "ACS Server", ref: "svc:acs", description: "RADIUS + TR-069" } },
      { op: "add_node", node: { id: "db", type: "net-database", label: "PostgreSQL", ref: "svc:pgsql" } },
      { op: "add_node", node: { id: "cpe1", type: "net-cpe", label: "CPE Site A", ref: "cpe:site-a" } },
      { op: "add_node", node: { id: "cpe2", type: "net-cpe", label: "CPE Site B", ref: "cpe:site-b" } },
      { op: "add_edge", edge: { id: "e-inet-fw", source: "internet", target: "fw", directed: true } },
      { op: "add_edge", edge: { id: "e-fw-r1", source: "fw", target: "r1", directed: true } },
      { op: "add_edge", edge: { id: "e-r1-sw1", source: "r1", target: "sw1", directed: true } },
      { op: "add_edge", edge: { id: "e-sw1-acs", source: "sw1", target: "acs", directed: true } },
      { op: "add_edge", edge: { id: "e-acs-db", source: "acs", target: "db", directed: true, label: "sql" } },
      { op: "add_edge", edge: { id: "e-r1-cpe1", source: "r1", target: "cpe1", directed: true, label: "pppoe" } },
      { op: "add_edge", edge: { id: "e-r1-cpe2", source: "r1", target: "cpe2", directed: true, label: "pppoe" } },
      { op: "add_group", group: { id: "g-hq", label: "HQ", children: ["fw", "r1", "sw1"] } },
      { op: "add_group", group: { id: "g-svc", label: "Services", children: ["acs", "db"] } },
    ],
  });
}
