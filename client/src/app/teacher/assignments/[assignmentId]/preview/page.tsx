"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getAssignmentByIdService, getQuestionsService } from "@/app/teacher/assignments/assignment.service";

interface Assignment {
  id: string;
  title: string;
  instructions: string | null;
  totalMarks: number;
}

interface Option {
  id?: string;
  value: string;
  isCorrect: boolean;
}

interface Question {
  id: string;
  type: "mcq" | "descriptive";
  description: string;
  marks: number;
  options: Option[];
}

export default function AssignmentPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.assignmentId as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [aRes, qRes] = await Promise.all([
          getAssignmentByIdService(assignmentId),
          getQuestionsService(assignmentId),
        ]);
        setAssignment(aRes.data);
        setQuestions(qRes.data || []);
      } catch {
        toast.error("Failed to load assignment");
      } finally {
        setLoading(false);
      }
    })();
  }, [assignmentId]);

  if (loading) return <div className="text-gray-400 text-center py-10">Loading preview...</div>;
  if (!assignment) return <div className="text-gray-400 text-center py-10">Assignment not found</div>;

  return (
    <div>
      <button
        onClick={() => router.push(`/teacher/assignments/${assignmentId}`)}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Assignment
      </button>

      <div className="w-full bg-[#0b0e14] border border-white/10 rounded-2xl p-5 sm:p-8">
        <div className="pb-6 mb-8 border-b-2 border-orange-500 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{assignment.title}</h2>
          {assignment.instructions && <p className="text-gray-400 text-sm mt-2">{assignment.instructions}</p>}
        </div>

        {questions.length === 0 ? (
          <p className="text-gray-500 text-center py-10">No questions added yet.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {questions.map((q, idx) => (
              <div key={q.id}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-white text-base font-medium leading-relaxed">
                    <span className="font-bold">Q{idx + 1}:</span> {q.description}
                  </p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/30 shrink-0 whitespace-nowrap">
                    {q.marks} marks
                  </span>
                </div>

                {q.type === "mcq" ? (
                  <div className="flex flex-col gap-2 pl-1">
                    {q.options.map((o, i) => (
                      <label key={o.id || i} className="flex items-center gap-2 text-sm text-gray-300">
                        <span className="h-4 w-4 rounded-full border border-white/20 shrink-0" />
                        {o.value}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="w-full bg-[#0f0f11] border border-white/10 rounded-lg px-5 py-4 min-h-[260px]">
                    <p className="text-gray-500 text-base leading-relaxed font-normal not-italic">Write your answer here...</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
