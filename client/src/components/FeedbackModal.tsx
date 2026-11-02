import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from './ui/card';
import { Textarea } from './ui/textarea';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { submitFeedbackService } from '../app/student/student.service';
import { cn } from '@/lib/utils';

interface FeedbackModalProps {
  examId: string;
  submissionId: string;
  hasTextQuestions: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function FeedbackModal({ examId, submissionId, hasTextQuestions, onClose, onSuccess }: FeedbackModalProps) {
  const [experienceRating, setExperienceRating] = useState<number>(0);
  const [experienceText, setExperienceText] = useState("");
  const [aiEvaluationRating, setAiEvaluationRating] = useState<number>(0);
  const [aiEvaluationText, setAiEvaluationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (experienceRating === 0) {
      toast.error("Please provide an experience rating.");
      return;
    }
    if (hasTextQuestions && aiEvaluationRating === 0) {
      toast.error("Please provide a rating for the AI evaluation.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFeedbackService({
        examId,
        submissionId,
        experienceRating,
        experienceText: experienceText || undefined,
        aiEvaluationRating: hasTextQuestions ? aiEvaluationRating : undefined,
        aiEvaluationText: hasTextQuestions ? (aiEvaluationText || undefined) : undefined,
      });
      toast.success("Thank you for your feedback!");
      onSuccess();
    } catch {
      toast.error("Failed to submit feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStars = (rating: number, setRating: (val: number) => void) => {
    return (
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "w-8 h-8 cursor-pointer transition-colors",
              star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-500 hover:text-gray-400"
            )}
            onClick={() => setRating(star)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/60 backdrop-blur-sm">
      <Card className="w-full max-w-lg bg-[#0f0f11] border-white/10 text-white shadow-2xl">
        <CardHeader>
          <CardTitle className="text-xl">Assessment Feedback</CardTitle>
          <CardDescription className="text-gray-400">
            Please share your experience. Your feedback helps us improve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300">How was your overall experience?</label>
            {renderStars(experienceRating, setExperienceRating)}
            <Textarea
              value={experienceText}
              onChange={(e) => setExperienceText(e.target.value)}
              placeholder="Tell us more about your experience (optional)"
              className="bg-[#14151f] border border-white/15 text-white placeholder:text-zinc-400 mt-2 resize-none"
              rows={3}
            />
          </div>

          {hasTextQuestions && (
            <div className="space-y-3 pt-4 border-t border-white/5">
              <label className="text-sm font-medium text-gray-300">How satisfied are you with the AI evaluation?</label>
              {renderStars(aiEvaluationRating, setAiEvaluationRating)}
              <Textarea
                value={aiEvaluationText}
                onChange={(e) => setAiEvaluationText(e.target.value)}
                placeholder="Any comments on the AI grading? (optional)"
                className="bg-[#14151f] border border-white/15 text-white placeholder:text-zinc-400 mt-2 resize-none"
                rows={3}
              />
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-3 pt-4 border-t border-white/5">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting} className="text-gray-400 hover:text-white">
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-purple-600 hover:bg-purple-700 text-white">
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
