"use client";

import React, { useEffect, useState } from "react";
import { Trophy, Clock, ArrowLeft, Search } from "lucide-react";
import { getExamLeaderboardService } from "@/app/student/student.service"; // Adjust import if needed
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/date";

export function LeaderboardView({
  examId,
}: {
  examId: string;
}) {
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!examId) return;

    const fetchLeaderboard = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await getExamLeaderboardService(examId);
        setLeaderboard(res.data || res);
      } catch (err: any) {
        setError(err.response?.data?.message || "Failed to load leaderboard.");
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [examId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 min-h-[50vh]">
        <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-400">Loading rankings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20 min-h-[50vh]">
        <div className="inline-block p-6 text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
          {error}
        </div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="text-center py-20 min-h-[50vh]">
        <div className="inline-block p-6 text-gray-400 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/20 rounded-xl border border-white/5">
          No results available for the leaderboard yet.
        </div>
      </div>
    );
  }

  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  const filteredRest = rest.filter((entry) =>
    entry.user.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Rearrange top3 for podium: 2nd, 1st, 3rd
  const podium = [];
  if (top3[1]) podium.push({ ...top3[1], rank: 2 });
  if (top3[0]) podium.push({ ...top3[0], rank: 1 });
  if (top3[2]) podium.push({ ...top3[2], rank: 3 });

  // If only 1 or 2 users exist, we just display them normally without reordering or we handle it gracefully:
  // Usually podium is [2nd, 1st, 3rd]. If 2nd is missing, it's just [1st].
  const getPodiumOrder = () => {
    if (top3.length === 1) return [{ ...top3[0], rank: 1 }];
    if (top3.length === 2) return [{ ...top3[1], rank: 2 }, { ...top3[0], rank: 1 }];
    return [{ ...top3[1], rank: 2 }, { ...top3[0], rank: 1 }, { ...top3[2], rank: 3 }];
  };

  const orderedPodium = getPodiumOrder();

  return (
    <div className="p-4 sm:p-8 h-full flex flex-col bg-[#050505] overflow-y-auto custom-scrollbar min-h-screen">
      <div className="w-full max-w-5xl mx-auto flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => router.back()}
                className="inline-flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Results
              </button>
            </div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              Exam Leaderboard — Results
            </h1>
            <p className="text-gray-400 mt-2">
              Final standings and per-student score breakdowns.
            </p>
          </div>
        </header>

        {/* Podium Section */}
        <div className="mb-16">
          <h2 className="text-xl font-bold text-white mb-2">Final Podium</h2>
          <p className="text-sm text-gray-400 mb-8">Top students from this exam.</p>

          <div className="flex flex-col sm:flex-row items-end justify-center gap-4 sm:gap-6 min-h-[250px]">
            {orderedPodium.map((entry) => {
              const isFirst = entry.rank === 1;
              const isSecond = entry.rank === 2;
              const isThird = entry.rank === 3;

              let cardBg = "bg-[#0f0f11]";
              let borderClass = "border-white/10";
              let titleColor = "text-gray-400";
              let titleText = "";
              let icon = null;
              let rankTextClass = "text-orange-500";
              let heightClass = "h-[260px]";

              if (isFirst) {
                cardBg = "bg-[#050505]";
                borderClass = "border-orange-500/50 ring-1 ring-blue-500/20 border-dashed";
                titleColor = "text-orange-400";
                titleText = "CHAMPION";
                icon = <Trophy className="h-10 w-10 text-yellow-500 mb-2" />;
                rankTextClass = "text-orange-400";
                heightClass = "h-[300px] z-10 scale-105 sm:scale-110 shadow-[0_0_30px_rgba(59,130,246,0.15)]";
              } else if (isSecond) {
                borderClass = "border-white/5";
                titleColor = "text-orange-500";
                titleText = "RUNNER-UP";
                icon = <Trophy className="h-8 w-8 text-gray-300 mb-2" />;
                rankTextClass = "text-orange-500";
                heightClass = "h-[280px]";
              } else if (isThird) {
                borderClass = "border-white/5";
                titleColor = "text-orange-500";
                titleText = "THIRD PLACE";
                icon = <Trophy className="h-8 w-8 text-amber-600 mb-2" />;
                rankTextClass = "text-orange-500";
                heightClass = "h-[260px]";
              }

              return (
                <div
                  key={entry.id}
                  className={`flex flex-col items-center justify-between p-6 rounded-2xl border transition-all w-full sm:w-[240px] ${cardBg} ${borderClass} ${heightClass}`}
                >
                  {icon}
                  <div className={`text-[10px] font-black tracking-widest uppercase mb-3 ${titleColor}`}>
                    {titleText}
                  </div>
                  <div className="text-lg font-bold text-white text-center truncate w-full mb-1">
                    {entry.user.name}
                  </div>
                  <div className="text-xs text-gray-500 truncate w-full text-center mb-4">
                    {entry.user.email || entry.user.id}
                  </div>
                  <div className={`text-sm font-bold bg-orange-500/10 px-4 py-1 rounded-full ${rankTextClass}`}>
                    {entry.rank}{entry.rank === 1 ? "st" : entry.rank === 2 ? "nd" : "rd"} Rank
                  </div>
                  <div className="mt-auto text-xl font-black text-white">
                    {entry.score} <span className="text-xs text-gray-500 font-normal">pts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Full Standings Section */}
        {rest.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Full Standings</h2>
            <p className="text-sm text-gray-400 mb-6">See where everyone else placed.</p>

            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-orange-400" />
              <Input
                placeholder="Search by student name..."
                className="text-white placeholder:text-zinc-400 h-11 text-sm transition-all pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="bg-[#0f0f11] rounded-xl border border-white/5 overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-[#050505]/50 text-gray-500 text-xs uppercase tracking-wider font-semibold border-b border-white/5">
                  <tr>
                    <th className="px-6 py-4 w-24 text-center">Rank</th>
                    <th className="px-6 py-4">Student</th>
                    <th className="px-6 py-4 text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredRest.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-gray-500">
                        No students found matching "{searchQuery}"
                      </td>
                    </tr>
                  ) : (
                    filteredRest.map((entry, index) => {
                      const actualRank = index + 4; // since top 3 are extracted
                      return (
                        <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex justify-center">
                              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-gray-400 font-bold border border-white/10">
                                #{actualRank}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-white text-base">
                                {entry.user.name}
                              </span>
                              <span className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                                <Clock className="h-3 w-3" />
                                {formatDateTime(entry.submittedAt)}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-2 w-32 bg-white/5 rounded-full overflow-hidden hidden sm:block">
                                <div 
                                  className="h-full bg-orange-500/50" 
                                  style={{ width: `${Math.min(100, (entry.score / Math.max(...leaderboard.map(l => l.score))) * 100)}%` }}
                                ></div>
                              </div>
                              <span className="font-bold text-white text-lg">
                                {entry.score}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
