import { BehaviorSubject, Observable } from "rxjs";
import { HostGroup, HostRecord } from "../models/types";
import { getLogger } from "../utils/logger";

export interface HostRegistrySnapshot {
  readonly hosts: ReadonlyArray<HostRecord>;
  readonly groups: ReadonlyArray<HostGroup>;
}

export interface ImportResult {
  readonly added: number;
  readonly updated: number;
  readonly skipped: number;
}

export class HostRegistry {
  private readonly logger = getLogger("HostRegistry");
  private readonly hosts = new Map<string, HostRecord>();
  private readonly groups = new Map<string, HostGroup>();
  private readonly subject = new BehaviorSubject<HostRegistrySnapshot>({ hosts: [], groups: [] });

  constructor(initialHosts: ReadonlyArray<HostRecord> = [], initialGroups: ReadonlyArray<HostGroup> = []) {
    initialHosts.forEach((host) => this.hosts.set(host.id, host));
    initialGroups.forEach((group) => this.groups.set(group.id, group));
    this.publish();
  }

  observe(): Observable<HostRegistrySnapshot> {
    return this.subject.asObservable();
  }

  listHosts(): ReadonlyArray<HostRecord> {
    return Array.from(this.hosts.values());
  }

  setHosts(hosts: ReadonlyArray<HostRecord>): void {
    this.hosts.clear();
    hosts.forEach((host) => this.hosts.set(host.id, host));
    this.publish();
  }

  listGroups(): ReadonlyArray<HostGroup> {
    return Array.from(this.groups.values());
  }

  setGroups(groups: ReadonlyArray<HostGroup>): void {
    this.groups.clear();
    groups.forEach((group) => this.groups.set(group.id, group));
    this.publish();
  }

  getHostById(hostId: string): HostRecord | undefined {
    return this.hosts.get(hostId);
  }

  upsertHost(host: HostRecord): void {
    this.hosts.set(host.id, host);
    this.publish();
  }

  upsertHosts(hosts: ReadonlyArray<HostRecord>): void {
    hosts.forEach((host) => this.hosts.set(host.id, host));
    this.publish();
  }

  removeHost(hostId: string): void {
    if (this.hosts.delete(hostId)) {
      this.publish();
    }
  }

  upsertGroup(group: HostGroup): void {
    this.groups.set(group.id, group);
    this.publish();
  }

  removeGroup(groupId: string): void {
    if (this.groups.delete(groupId)) {
      this.publish();
    }
  }

  toggleHost(hostId: string, enabled: boolean): void {
    const host = this.hosts.get(hostId);
    if (!host) {
      return;
    }

    this.hosts.set(hostId, {
      ...host,
      enabled
    });
    this.publish();
  }

  assignHostToGroup(hostId: string, groupId: string): void {
    const host = this.hosts.get(hostId);
    const group = this.groups.get(groupId);
    if (!host || !group) {
      return;
    }

    const updatedGroup: HostGroup = {
      ...group,
      hostIds: Array.from(new Set([...group.hostIds, hostId]))
    };

    this.groups.set(groupId, updatedGroup);
    this.publish();
  }

  unassignHostFromGroup(hostId: string, groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      return;
    }

    const updatedGroup: HostGroup = {
      ...group,
      hostIds: group.hostIds.filter((id) => id !== hostId)
    };

    this.groups.set(groupId, updatedGroup);
    this.publish();
  }

  filterHosts(predicate: (host: HostRecord) => boolean): ReadonlyArray<HostRecord> {
    return this.listHosts().filter(predicate);
  }

  findByTag(tag: string): ReadonlyArray<HostRecord> {
    return this.filterHosts((host) => host.tags.includes(tag));
  }

  importFromCsv(csvContent: string, defaults: Partial<HostRecord> = {}): ImportResult {
    const lines = csvContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return { added: 0, updated: 0, skipped: 0 };
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idIndex = headers.indexOf("id");
    const nameIndex = headers.indexOf("nom") >= 0 ? headers.indexOf("nom") : headers.indexOf("name");
    const addressIndex = headers.indexOf("ip") >= 0 ? headers.indexOf("ip") : headers.indexOf("address");
    const osIndex = headers.indexOf("os");
    const tagsIndex = headers.indexOf("tag") >= 0 ? headers.indexOf("tag") : headers.indexOf("tags");

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i += 1) {
      const rawColumns = lines[i].split(",").map((value) => value.trim());
      const id = rawColumns[idIndex] ?? `host-${i}`;
      const name = rawColumns[nameIndex] ?? id;
      const address = rawColumns[addressIndex] ?? "";
      if (!address) {
        skipped += 1;
        continue;
      }

      const os = (rawColumns[osIndex] as HostRecord["os"]) ?? defaults.os ?? "windows";
      const tagsRaw = rawColumns[tagsIndex] ?? "";
      const tags = tagsRaw.length > 0 ? tagsRaw.split(/;|\|/).map((tag) => tag.trim()).filter(Boolean) : [];

      const host: HostRecord = {
        id,
        name,
        address,
        os,
        tags,
        enabled: defaults.enabled ?? true,
        groups: defaults.groups ?? [],
        notes: defaults.notes,
        lastSeenAt: defaults.lastSeenAt
      };

      if (this.hosts.has(id)) {
        updated += 1;
      } else {
        added += 1;
      }

      this.hosts.set(id, host);
    }

    this.publish();

    return { added, updated, skipped };
  }

  private publish(): void {
    const snapshot: HostRegistrySnapshot = {
      hosts: this.listHosts(),
      groups: this.listGroups()
    };
    this.subject.next(snapshot);
    this.logger.debug(
      {
        hosts: snapshot.hosts.length,
        groups: snapshot.groups.length
      },
      "Snapshot host registry mis à jour"
    );
  }
}
