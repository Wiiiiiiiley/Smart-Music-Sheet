ALTER TABLE "Mark" ADD COLUMN "targetMemberId" TEXT;
ALTER TABLE "Mark" ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Score" ADD COLUMN "audioTracks" TEXT NOT NULL DEFAULT '[]';
CREATE INDEX "Mark_targetMemberId_idx" ON "Mark"("targetMemberId");
ALTER TABLE "Score" ADD COLUMN "measureRegions" TEXT NOT NULL DEFAULT '[]';
