-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "commit_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "x_draft" TEXT,
    "linkedin_draft" TEXT,
    "updated_x_draft" TEXT,
    "updated_linkedin_draft" TEXT,
    "prompt_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_commit_hash_key" ON "posts"("commit_hash");
