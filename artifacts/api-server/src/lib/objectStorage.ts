import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ObjectAclPolicy, ObjectPermission, canAccessObject, getObjectAclPolicy, setObjectAclPolicy } from "./objectAcl";

const LOCAL_UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(LOCAL_UPLOADS_DIR)) fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    return `/api/uploads/${objectId}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    return rawPath;
  }

  async searchPublicObject(filePath: string): Promise<{ localPath: string } | null> {
    const localPath = path.join(LOCAL_UPLOADS_DIR, filePath);
    if (fs.existsSync(localPath)) return { localPath };
    return null;
  }

  async downloadObject(file: { localPath: string }, _cacheTtlSec: number = 3600): Promise<Response> {
    const buffer = fs.readFileSync(file.localPath);
    return new Response(buffer);
  }

  async getObjectEntityFile(objectPath: string): Promise<{ localPath: string }> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const filename = objectPath.replace("/objects/", "");
    const localPath = path.join(LOCAL_UPLOADS_DIR, filename);
    if (!fs.existsSync(localPath)) throw new ObjectNotFoundError();
    return { localPath };
  }

  async trySetObjectEntityAclPolicy(rawPath: string, _aclPolicy: ObjectAclPolicy): Promise<string> {
    return rawPath;
  }

  async canAccessObjectEntity(_opts: {
    userId?: string;
    objectFile: unknown;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return true;
  }
}

export type { ObjectAclPolicy, ObjectPermission };
export { canAccessObject, getObjectAclPolicy, setObjectAclPolicy };
