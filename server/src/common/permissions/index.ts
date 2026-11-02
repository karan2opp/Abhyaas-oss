import db from "../db/index.js";
import { exams, sections, assignments, assignmentSeries } from "../db/schema.js";
import { eq } from "drizzle-orm";

export type Requester = { id: string; role: string };

// Every exam, assignment and series is owned by the teacher who created it;
// only that teacher can manage it.
class TeacherPermissions {
    static async canManageExam(teacherId: string, examId: string): Promise<boolean> {
        const [exam] = await db.select({ createdBy: exams.createdBy }).from(exams).where(eq(exams.id, examId));
        return exam?.createdBy === teacherId;
    }

    static async canManageAssignment(teacherId: string, assignmentId: string): Promise<boolean> {
        const [assignment] = await db.select({ createdBy: assignments.createdBy }).from(assignments).where(eq(assignments.id, assignmentId));
        return assignment?.createdBy === teacherId;
    }

    static async canManageSeries(teacherId: string, seriesId: string): Promise<boolean> {
        const [series] = await db.select({ createdBy: assignmentSeries.createdBy }).from(assignmentSeries).where(eq(assignmentSeries.id, seriesId));
        return series?.createdBy === teacherId;
    }

    static async canManageSection(teacherId: string, sectionId: string): Promise<boolean> {
        const [section] = await db.select({ examId: sections.examId })
            .from(sections)
            .where(eq(sections.id, sectionId));

        if (!section) return false;
        return TeacherPermissions.canManageExam(teacherId, section.examId);
    }
}

export class PermissionService {
    static readonly teacher = TeacherPermissions;

    static async canManageExam(requester: Requester, examId: string): Promise<boolean> {
        return TeacherPermissions.canManageExam(requester.id, examId);
    }

    static async canManageSection(requester: Requester, sectionId: string): Promise<boolean> {
        return TeacherPermissions.canManageSection(requester.id, sectionId);
    }
}
