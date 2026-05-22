import { Db } from "mongodb";
import { collections } from "../db/collections";

export async function getDiagnosticsByFindingId(db: Db, findingId: string) {
  return db.collection(collections.findingDiagnostics).findOne(
    { finding_id: findingId },
    { projection: { _id: 0 } }
  );
}
