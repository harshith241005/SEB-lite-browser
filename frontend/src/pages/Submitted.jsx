import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearAuth } from "../utils/auth";
import { useExam } from "../context/ExamContext";

export default function Submitted() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resetExam } = useExam();
  const [showBreakdown, setShowBreakdown] = useState(false);
  
  const { 
    score = 0, 
    passed = false, 
    exam = "Exam", 
    violations = 0,
    autoSubmitted = false,
    reason = "",
    correctAnswers = 0,
    totalQuestions = 0,
    questionBreakdown = [],
    violationDetails = []
  } = location.state || {};

  // Reset exam context on mount
  useEffect(() => {
    resetExam();
  }, [resetExam]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  return (
    <div className={`min-h-screen ${passed ? 'bg-gradient-to-br from-green-400 to-green-600' : 'bg-gradient-to-br from-orange-400 to-red-500'} flex items-center justify-center p-4`}>
      <div className="bg-white rounded-lg shadow-2xl p-8 max-w-2xl w-full">
        {/* Auto-submit warning banner */}
        {autoSubmitted && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center">
              <span className="text-2xl mr-2">🚨</span>
              <div>
                <p className="text-red-800 font-semibold">Exam Auto-Submitted</p>
                <p className="text-red-600 text-sm">{reason || "Security violation limit exceeded"}</p>
              </div>
            </div>
          </div>
        )}

        <div className="text-center">
          <div className="text-6xl mb-4">
            {passed ? "🎉" : "📝"}
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            {passed ? "Congratulations! You Passed!" : "Exam Submitted"}
          </h1>
          <p className="text-gray-600 mb-6">
            {exam}
          </p>
        </div>

        <div className="bg-gray-100 rounded-lg p-6 mb-6 text-center">
          <p className="text-gray-600 text-sm">Your Score</p>
          <p className={`text-5xl font-bold ${passed ? 'text-green-600' : 'text-blue-600'}`}>
            {typeof score === 'number' ? score.toFixed(1) : score}%
          </p>
          {totalQuestions > 0 && (
            <p className="text-gray-500 text-sm mt-2">
              {correctAnswers} correct out of {totalQuestions} questions
            </p>
          )}
          <p className="text-gray-600 text-sm mt-2">
            {passed
              ? `Great job! You have successfully passed the exam.`
              : `Keep practicing and try again!`}
          </p>
        </div>

        {/* Violations section */}
        {violations > 0 && (
          <div className={`${violations >= 3 ? 'bg-red-50 border-red-300' : 'bg-yellow-50 border-yellow-200'} border rounded-lg p-4 mb-6`}>
            <div className="flex items-center justify-center">
              <span className="text-xl mr-2">⚠️</span>
              <p className={`${violations >= 3 ? 'text-red-800' : 'text-yellow-800'} text-sm font-medium`}>
                {violations} violation(s) were recorded during your exam
              </p>
            </div>
            {violationDetails && violationDetails.length > 0 && (
              <div className="mt-3 space-y-1">
                {violationDetails.map((v, i) => (
                  <div key={i} className="text-xs text-gray-600 flex items-center">
                    <span className={`w-2 h-2 rounded-full mr-2 ${
                      v.severity === 'high' ? 'bg-red-500' : 
                      v.severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                    }`}></span>
                    {v.type}: {v.description}
                  </div>
                ))}
              </div>
            )}
            <p className={`${violations >= 3 ? 'text-red-600' : 'text-yellow-600'} text-xs mt-2 text-center`}>
              Violations are logged and may affect your exam evaluation.
            </p>
          </div>
        )}

        {/* No violations - clean exam */}
        {violations === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center">
              <span className="text-xl mr-2">✅</span>
              <p className="text-green-800 text-sm font-medium">
                Clean exam - No security violations detected
              </p>
            </div>
          </div>
        )}

        {/* Question Breakdown Toggle */}
        {questionBreakdown && questionBreakdown.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition border border-gray-200"
            >
              <span className="font-medium text-gray-700">📊 Question-wise Breakdown</span>
              <span className="text-gray-500">{showBreakdown ? '▲' : '▼'}</span>
            </button>
            
            {showBreakdown && (
              <div className="mt-4 max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                {questionBreakdown.map((q, index) => (
                  <div 
                    key={index} 
                    className={`p-3 border-b border-gray-100 ${
                      q.isCorrect ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    <div className="flex items-start">
                      <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mr-3 ${
                        q.isCorrect ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                      }`}>
                        {q.isCorrect ? '✓' : '✗'}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800 mb-1">
                          Q{index + 1}: {q.question?.substring(0, 80)}...
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">Your answer: </span>
                            <span className={q.isCorrect ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                              {q.yourAnswer || 'Not answered'}
                            </span>
                          </div>
                          {!q.isCorrect && (
                            <div>
                              <span className="text-gray-500">Correct: </span>
                              <span className="text-green-700 font-medium">{q.correctAnswer}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={() => navigate("/student-dashboard")}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
          >
            Back to Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="w-full px-6 py-3 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
