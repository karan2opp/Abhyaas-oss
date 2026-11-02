import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "../../common/middleware/auth.middleware.js";
import {
    uploadDocumentHandler,
    listDocumentsHandler,
    getDocumentStatusHandler,
    renameDocumentHandler,
    deleteDocumentHandler,
    generateFromDocumentsHandler,
    listTopicsHandler,
    searchQuestionBankHandler,
} from "./question_bank.controller.js";

const pdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") cb(null, true);
        else cb(new Error("Only PDF files are allowed"));
    },
});

const router = Router();

router.post(
    "/documents",
    authenticate,
    authorize("teacher"),
    pdfUpload.single("file"),
    uploadDocumentHandler
);

router.get(
    "/documents",
    authenticate,
    authorize("teacher"),
    listDocumentsHandler
);

router.get(
    "/documents/:documentId",
    authenticate,
    authorize("teacher"),
    getDocumentStatusHandler
);

router.patch(
    "/documents/:documentId",
    authenticate,
    authorize("teacher"),
    renameDocumentHandler
);

router.delete(
    "/documents/:documentId",
    authenticate,
    authorize("teacher"),
    deleteDocumentHandler
);

router.get(
    "/topics",
    authenticate,
    authorize("system_admin", "teacher", "manager"),
    listTopicsHandler
);

router.post(
    "/generate",
    authenticate,
    authorize("teacher"),
    generateFromDocumentsHandler
);

router.post(
    "/search",
    authenticate,
    authorize("teacher"),
    searchQuestionBankHandler
);

export default router;
