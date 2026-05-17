-- CreateEnum
CREATE TYPE "Role" AS ENUM ('IT_ADMIN', 'REQUESTOR', 'LEGAL_TEAM', 'VENDOR');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('INVITED', 'SUBMITTED', 'REVISION', 'APPROVED');

-- CreateEnum
CREATE TYPE "VendorType" AS ENUM ('BADAN', 'PERORANGAN');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('PERJANJIAN_BARU', 'ADENDUM', 'SURAT', 'PERMINTAAN_DOKUMEN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'WAITING', 'LEGAL_REVIEW', 'USER_REVIEW', 'VENDOR_REVIEW', 'INTERNAL_SIGNING', 'VENDOR_SIGNING', 'FINISHED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StatusPerjanjian" AS ENUM ('BELUM_BERLANGSUNG', 'SEDANG_BERLANGSUNG', 'SUDAH_SELESAI');

-- CreateEnum
CREATE TYPE "HolidayType" AS ENUM ('NATIONAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "KybDocumentType" AS ENUM ('AKTA_PENDIRIAN', 'SK_PENDIRIAN', 'NIB', 'KTP_PENANGGUNG_JAWAB', 'NPWP_BADAN', 'AKTA_PERUBAHAN_DIREKSI', 'SK_PERUBAHAN_DIREKSI', 'SURAT_KUASA', 'KTP', 'NPWP');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('ADENDUM_PREVIOUS_AGREEMENT', 'SURAT_PRIOR_CORRESPONDENCE', 'PERMINTAAN_SUPPORTING_DOC');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namaLengkap" TEXT NOT NULL,
    "lokasiKantorId" TEXT NOT NULL,
    "divisiId" TEXT NOT NULL,
    "unitBisnisId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "supabaseId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "type" "VendorType",
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'INVITED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KybDocument" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "documentType" "KybDocumentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KybDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KybReview" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KybReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRequest" (
    "id" TEXT NOT NULL,
    "requestorId" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'DRAFT',
    "referenceNumber" TEXT,
    "vendorId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "slaDeadline" TIMESTAMP(3),
    "slaNotifiedApproaching" BOOLEAN NOT NULL DEFAULT false,
    "slaNotifiedBreached" BOOLEAN NOT NULL DEFAULT false,
    "firstHandlerId" TEXT,
    "rejectionReason" TEXT,
    "requiresInternalSigning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRequestData" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lingkupPerjanjian" TEXT,
    "statusPerjanjian" "StatusPerjanjian",
    "jangkaWaktuStart" TIMESTAMP(3),
    "jangkaWaktuEnd" TIMESTAMP(3),
    "perjanjianSebelumnya" TEXT,
    "halYangInginDiubah" TEXT,
    "suratYangHendakDibuat" TEXT,
    "identitasPenerimaSurat" TEXT,
    "dokumenYangDiminta" TEXT,
    "tujuanPermintaan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalRequestData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalRequestAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStage" "RequestStatus",
    "toStage" "RequestStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "workingDays" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "type" "HolidayType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LokasiKantor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LokasiKantor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Divisi" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Divisi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitBisnis" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitBisnis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseId_key" ON "User"("supabaseId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RequestorProfile_userId_key" ON "RequestorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_supabaseId_key" ON "Vendor"("supabaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRequest_referenceNumber_key" ON "LegalRequest"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LegalRequestData_requestId_key" ON "LegalRequestData"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_type_key" ON "Holiday"("date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Divisi_code_key" ON "Divisi"("code");

-- AddForeignKey
ALTER TABLE "RequestorProfile" ADD CONSTRAINT "RequestorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestorProfile" ADD CONSTRAINT "RequestorProfile_lokasiKantorId_fkey" FOREIGN KEY ("lokasiKantorId") REFERENCES "LokasiKantor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestorProfile" ADD CONSTRAINT "RequestorProfile_divisiId_fkey" FOREIGN KEY ("divisiId") REFERENCES "Divisi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestorProfile" ADD CONSTRAINT "RequestorProfile_unitBisnisId_fkey" FOREIGN KEY ("unitBisnisId") REFERENCES "UnitBisnis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KybDocument" ADD CONSTRAINT "KybDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KybReview" ADD CONSTRAINT "KybReview_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KybReview" ADD CONSTRAINT "KybReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_requestorId_fkey" FOREIGN KEY ("requestorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_firstHandlerId_fkey" FOREIGN KEY ("firstHandlerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRequest" ADD CONSTRAINT "LegalRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRequestData" ADD CONSTRAINT "LegalRequestData_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LegalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalRequestAttachment" ADD CONSTRAINT "LegalRequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LegalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalDocument" ADD CONSTRAINT "FinalDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LegalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LegalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
