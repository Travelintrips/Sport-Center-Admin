export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

export async function setObjectAclPolicy(_file: unknown, _policy: ObjectAclPolicy): Promise<void> {}

export async function getObjectAclPolicy(_file: unknown): Promise<ObjectAclPolicy | null> {
  return { owner: "", visibility: "public" };
}

export async function canAccessObject(_opts: {
  userId?: string;
  objectFile: unknown;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  return true;
}
