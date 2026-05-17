-- CreateTable
CREATE TABLE "RequestCounter" (
    "year" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequestCounter_pkey" PRIMARY KEY ("year")
);
