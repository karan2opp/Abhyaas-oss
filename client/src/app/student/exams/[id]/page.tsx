"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { getExamForSubmissionService, getSubmissionByIdService, submitAnswerService, submitExamService } from "@/app/student/student.service";
import { TestTakingScreen, clearLocalSnapshot, type TestQuestion } from "@/components/TestTakingScreen";

export default function ExamAttemptPage() {
  const params = useParams();
  const submissionId = params.id as string;
  const router = useRouter();

  const [examData, setExamData] = useState<any>(null);
  const [submissionData, setSubmissionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [initialAnswers, setInitialAnswers] = useState<Record<string, string[]>>({});
  const [initialTextAnswers, setInitialTextAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!submissionId) return;

    const fetchData = async () => {
      try {
        const [examRes, subRes] = await Promise.all([getExamForSubmissionService(submissionId), getSubmissionByIdService(submissionId)]);

        const exam = examRes.data || examRes;
        const sub = subRes.data || subRes;

        if (sub.status !== "inprogress") {
          clearLocalSnapshot(submissionId);
          toast.info("This exam is already submitted or timeout.");
          router.replace(`/student/results/${submissionId}`);
          return;
        }

        const answers: Record<string, string[]> = {};
        const textAnswers: Record<string, string> = {};
        for (const ans of sub.answers ?? []) {
          if (ans.options) answers[ans.questionId] = ans.options;
          if (ans.textAnswer) textAnswers[ans.questionId] = ans.textAnswer;
        }
        setInitialAnswers(answers);
        setInitialTextAnswers(textAnswers);
        setExamData(exam);
        setSubmissionData(sub);
      } catch {
        toast.error("Failed to load the exam.");
        router.push("/student");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [submissionId, router]);

  // Every section's questions in one list, numbered across the exam.
  const questions = useMemo<TestQuestion[]>(() => {
    if (!examData?.sections) return [];
    let globalIndex = 0;
    return examData.sections.flatMap((section: any) =>
      (section.questions ?? []).map((q: any) => ({
        id: q.id,
        globalIndex: globalIndex++,
        sectionTitle: section.title,
        description: q.description,
        marks: q.marks,
        type: q.type,
        options: q.options || [],
        images: q.images || [],
        contentBlocks: q.contentBlocks || [],
      }))
    );
  }, [examData]);

  if (loading) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">Loading Exam...</div>;
  if (!examData) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">Exam not found.</div>;
  if (questions.length === 0) return <div className="flex items-center justify-center h-full bg-[#050505] text-white">No questions in this exam.</div>;

  const totalMarks = questions.reduce((acc, q) => acc + (q.marks || 0), 0);
  const duration = examData.duration || 60;

  return (
    <TestTakingScreen
      kind="exam"
      title={examData.title}
      storageId={submissionId}
      questions={questions}
      sectionTitles={(examData.sections ?? []).map((s: any) => s.title)}
      initialAnswers={initialAnswers}
      initialTextAnswers={initialTextAnswers}
      // The time runs from when the student started the exam.
      clock={{ kind: "timer", endTime: new Date(submissionData.createdAt).getTime() + duration * 60 * 1000 }}
      instructionStats={[
        { label: "Duration", value: `${duration} mins` },
        { label: "Questions", value: String(questions.length) },
        { label: "Marks", value: String(totalMarks), accent: true },
        { label: "Sections", value: String(examData.sections?.length || 1) },
      ]}
      saveAnswer={async (questionId, answer) => {
        await submitAnswerService({ submissionId, questionId, ...answer });
      }}
      submit={async () => {
        await submitExamService(submissionId);
      }}
      onSubmitted={() => router.push(`/student/results/${submissionId}`)}
      onAlreadySubmitted={() => router.replace(`/student/results/${submissionId}`)}
    />
  );
}
