import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import Timer from "../components/Timer";
// eslint-disable-next-line no-unused-vars
import QuestionPalette from "../components/QuestionPalette";
import { API_ENDPOINTS, axiosConfig } from "../utils/api";
import { useExam } from "../context/ExamContext";
import { getAccessToken } from "../utils/auth";

export default function Exam() {
  const {
    exam,
    setExam,
    answers,
    updateAnswer,
    currentQuestion,
    setCurrentQuestion,
    timeRemaining, // eslint-disable-line no-unused-vars
    setTimeRemaining,
    violations,
    addViolation,
    examSubmitted, // eslint-disable-line no-unused-vars
    setExamSubmitted,
    examStarted, // eslint-disable-line no-unused-vars
    setExamStarted
  } = useExam();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  // eslint-disable-next-line no-unused-vars
  const [blurWarningCount, setBlurWarningCount] = useState(0);
  const navigate = useNavigate();
  const { examId } = useParams();
  
  // Ref to prevent duplicate fetch calls
  const hasFetched = useRef(false);

  const token = getAccessToken();

  // Configure axios with auth header
  const authConfig = useMemo(() => ({
    ...axiosConfig,
    headers: {
      ...axiosConfig.headers,
      Authorization: `Bearer ${token}`,
    },
  }), [token]);

  const fetchExam = useCallback(async () => {
    // Prevent duplicate fetches
    if (hasFetched.current) {
      console.log('Already fetched exam, skipping...');
      return;
    }
    hasFetched.current = true;
    
    try {
      console.log('Fetching exam with ID:', examId);
      console.log('API URL:', API_ENDPOINTS.EXAM_START(examId));
      console.log('Token present:', !!token);
      
      // Use EXAM_START endpoint to get questions
      const response = await axios.get(API_ENDPOINTS.EXAM_START(examId), authConfig);
      
      console.log('Exam response:', response.data);
      
      // The response contains { exam: {...}, questions: [...], progress: {...} }
      const examData = {
        ...response.data.exam,
        questions: response.data.questions || []
      };
      
      setExam(examData);
      const duration = examData.duration * 60; // Convert minutes to seconds

      // Restore progress from server if available
      if (response.data.progress) {
        const { answers: savedAnswers, timeRemaining: serverTime } = response.data.progress;
        
        // Restore answers from server
        if (savedAnswers && savedAnswers.length > 0) {
          savedAnswers.forEach(answer => {
            updateAnswer(answer.questionIndex, answer.selectedOption);
          });
        }
        
        // Use server time remaining if available
        if (serverTime && serverTime > 0) {
          setTimeRemaining(serverTime);
        } else {
          setTimeRemaining(duration);
        }
        
        setExamStarted(true);
      } else {
        setTimeRemaining(duration);
      }

      // Also check localStorage for any unsaved local progress
      const savedQuestion = localStorage.getItem(`exam_${examId}_currentQuestion`);
      if (savedQuestion) {
        const questionIndex = parseInt(savedQuestion);
        if (questionIndex >= 0 && questionIndex < examData.questions.length) {
          setCurrentQuestion(questionIndex);
        }
      }
    } catch (err) {
      console.error('Exam fetch error:', err);
      console.error('Error response:', err.response?.data);
      const errorMsg = err.response?.data?.error || "Failed to load exam. Please try again.";
      setError(errorMsg);
      // Reset hasFetched on error so user can retry
      hasFetched.current = false;
    } finally {
      setLoading(false);
    }
  }, [examId, authConfig, setExam, setTimeRemaining, updateAnswer, setCurrentQuestion, setExamStarted, token]);

  const logViolation = useCallback(async (type, description, severity) => {
    try {
      if (!exam) return;
      
      // Log to backend
      const response = await axios.post(
        API_ENDPOINTS.VIOLATIONS,
        {
          examId: exam._id || exam.id,
          violationType: type,
          severity,
          description,
          timestamp: new Date(),
          timeRemaining,
        },
        authConfig
      );

      // Log to Electron if available
      if (window.electronAPI) {
        await window.electronAPI.logViolation({
          type,
          description,
          severity
        });
      }

      addViolation({ type, severity, timestamp: new Date() });

      // Check if auto-submitted by backend due to violation limit
      if (response.data.autoSubmitted) {
        setExamSubmitted(true);
        navigate("/submitted", {
          state: {
            score: response.data.submission?.score || 0,
            passed: response.data.submission?.passed || false,
            exam: exam.title,
            violations: response.data.violationCount,
            correctAnswers: response.data.submission?.correctAnswers || 0,
            totalQuestions: response.data.submission?.totalQuestions || 0,
            autoSubmitted: true,
            reason: "Maximum violation limit exceeded"
          },
        });
        return;
      }

      // Client-side fallback check for violation limit
      const maxViolations = exam.maxViolations || 3;
      const currentViolationCount = violations.length + 1; // +1 because we just added one
      if (currentViolationCount >= maxViolations) {
        console.warn('Violation limit reached - exam will be auto-submitted');
        // Set a flag to trigger auto-submit
        setWarningMessage('Maximum violations exceeded! Exam will be auto-submitted.');
        setShowWarning(true);
      }
    } catch (err) {
      console.error("Failed to log violation:", err);
    }
  }, [exam, authConfig, addViolation, timeRemaining, navigate, setExamSubmitted, violations]);

  const handleAnswerChange = (questionIndex, answer) => {
    updateAnswer(questionIndex, answer);
  };

  const handleQuestionClick = (index) => {
    setCurrentQuestion(index);
  };

  const handleSubmit = useCallback(async () => {
    try {
      // Build answers array with questionIndex and selectedOption
      const submissionAnswers = exam.questions.map((q, index) => ({
        questionIndex: q.questionIndex !== undefined ? q.questionIndex : index,
        selectedOption: answers[q.questionIndex !== undefined ? q.questionIndex : index],
      }));

      // Encrypt answers before submission if Electron is available
      let encryptedId = null;
      if (window.electronAPI) {
        try {
          const encryptResult = await window.electronAPI.encryptAnswers(answers);
          if (encryptResult.success) {
            encryptedId = encryptResult.id;
            console.log('Answers encrypted successfully');
          }
        } catch (encryptError) {
          console.warn('Failed to encrypt answers:', encryptError);
        }
      }

      const response = await axios.post(
        API_ENDPOINTS.SUBMIT_EXAM(exam.id || exam._id),
        {
          answers: submissionAnswers,
          encryptedId,
          violations: violations.length
        },
        authConfig
      );

      setExamSubmitted(true);

      // Stop Electron monitoring
      if (window.electronAPI) {
        await window.electronAPI.stopExamMonitoring();
      }

      // Clear saved answers and state
      const examId = exam._id || exam.id;
      localStorage.removeItem(`exam_${examId}_answers`);
      localStorage.removeItem(`exam_${examId}_timestamp`);
      localStorage.removeItem(`exam_${examId}_timeRemaining`);
      localStorage.removeItem(`exam_${examId}_currentQuestion`);

      navigate("/submitted", {
        state: {
          score: response.data.score,
          passed: response.data.passed,
          exam: exam.title,
          violations: violations.length,
          correctAnswers: response.data.correctAnswers,
          totalQuestions: response.data.totalQuestions,
          questionBreakdown: response.data.questionBreakdown || [],
          violationDetails: violations.map(v => ({
            type: v.type || v.violationType,
            description: v.description,
            severity: v.severity
          })),
          autoSubmitted: false
        },
      });
    } catch (err) {
      setError("Failed to submit exam. Please try again.");
      console.error(err);
    }
  }, [exam, answers, authConfig, setExamSubmitted, navigate, violations]);

  // Auto-submit when violations exceed limit
  useEffect(() => {
    if (!exam || examSubmitted) return;
    
    const maxViolations = exam.maxViolations || 3;
    if (violations.length >= maxViolations) {
      console.warn('Auto-submitting due to violation limit');
      handleSubmit();
    }
  }, [violations.length, exam, examSubmitted, handleSubmit]);

  // Timer effect - disabled for now
  // useEffect(() => {
  //   if (!exam || examSubmitted || timeRemaining <= 0) return;
    
  //   if (!examStarted) {
  //     setExamStarted(true);
  //     localStorage.setItem('exam_started', 'true');
  //   }

  //   const timer = setInterval(() => {
  //     setTimeRemaining((prev) => {
  //       if (prev <= 1) {
  //         handleSubmit();
  //         return 0;
  //       }
  //       return prev - 1;
  //     });
  //   }, 1000);

  //   return () => clearInterval(timer);
  // }, [exam, examSubmitted, handleSubmit, timeRemaining, examStarted, setExamStarted]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!exam || examSubmitted) return;
      
      // Arrow key navigation
      if (e.key === 'ArrowLeft' && currentQuestion > 0) {
        e.preventDefault();
        setCurrentQuestion(currentQuestion - 1);
      } else if (e.key === 'ArrowRight' && currentQuestion < exam.questions.length - 1) {
        e.preventDefault();
        setCurrentQuestion(currentQuestion + 1);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [exam, currentQuestion, examSubmitted, setCurrentQuestion]);

  // Proctoring: Detect tab switch, fullscreen exit, etc.
  useEffect(() => {
    if (!exam || !examStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden && exam) {
        logViolation("WINDOW_BLUR", "Student switched tabs or lost focus", "medium");
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && exam) {
        logViolation("SHORTCUT_ATTEMPT", "Student exited fullscreen mode", "high");
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      // Don't log right-click as violation, just block it
      console.log('Right-click blocked during exam');
      return false;
    };

    // Prevent refresh
    const handleBeforeUnload = (e) => {
      if (examStarted && !examSubmitted) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to leave? Your progress will be saved.';
        return e.returnValue;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [exam, examStarted, examSubmitted, logViolation]);

  // Load exam when component mounts (only once)
  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    fetchExam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, token]);

  // Setup Electron monitoring after exam is loaded
  useEffect(() => {
    if (!exam || !window.electronAPI) return;

    window.electronAPI.startExamMonitoring({
      id: examId,
      title: exam.title,
      duration: exam.duration,
      maxViolations: exam.proctoring?.maxViolations || 5
    }).then(() => {
      localStorage.setItem('exam_started', 'true');
      console.log('Exam monitoring started');

      // Listen for violations from Electron
      const cleanup = window.electronAPI.onViolationDetected((event, violation) => {
        logViolation(violation.type, violation.description, violation.severity);
      });

      // Listen for auto-submit events
      const autoSubmitCleanup = window.electronAPI.onAutoSubmit(async (event, data) => {
        console.log('Auto-submit triggered:', data);
        try {
          await handleSubmit();
          alert(`Exam auto-submitted due to: ${data.reason}`);
        } catch (error) {
          console.error('Auto-submit failed:', error);
        }
      });

      // Listen for window blur events
      const blurCleanup = window.electronAPI.onWindowBlur(() => {
        setBlurWarningCount(prev => {
          const newCount = prev + 1;
          setWarningMessage(`Warning: Window focus lost (${newCount}). This has been logged as a violation.`);
          return newCount;
        });
        setShowWarning(true);
        // Hide warning after 5 seconds
        setTimeout(() => setShowWarning(false), 5000);

        // Log violation to backend
        logViolation("WINDOW_BLUR", "Window lost focus during exam", "medium");
      });

      return () => {
        cleanup();
        autoSubmitCleanup();
        blurCleanup();
      };
    }).catch(err => {
      console.warn('Electron monitoring not available:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, examId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
          <div className="text-xl font-semibold text-gray-700">Loading exam...</div>
          <div className="text-sm text-gray-500 mt-2">Please wait</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-red-50 to-red-100">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <p className="text-red-600 font-semibold text-lg mb-4">{error}</p>
            <button
              onClick={() => navigate("/student-dashboard")}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">No exam found</div>
      </div>
    );
  }

  // Check if questions exist
  if (!exam.questions || exam.questions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="text-xl font-semibold text-gray-700 mb-4">No questions available for this exam</div>
          <button
            onClick={() => navigate("/student-dashboard")}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const question = exam.questions[currentQuestion];
  // eslint-disable-next-line no-unused-vars
  const progress = ((currentQuestion + 1) / exam.questions.length) * 100;
  const answeredCount = Object.keys(answers).length;

  // Safety check for current question
  if (!question) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">Loading question...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Top Header Bar */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Exam Title & Progress */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-lg font-bold">📝</span>
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">{exam.title}</h1>
                  <p className="text-xs text-slate-400">Secure Exam Browser</p>
                </div>
              </div>
              
              {/* Progress Indicator */}
              <div className="hidden md:flex items-center gap-3 bg-slate-700/50 px-4 py-2 rounded-lg">
                <div className="text-sm text-slate-300">
                  <span className="text-indigo-400 font-semibold">{answeredCount}</span>
                  <span className="text-slate-500">/</span>
                  <span>{exam.questions.length}</span>
                  <span className="text-slate-500 ml-1">answered</span>
                </div>
                <div className="w-32 bg-slate-600 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${(answeredCount / exam.questions.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Timer & Status */}
            <div className="flex items-center gap-4">
              {/* Security Status */}
              <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                violations.length === 0 
                  ? 'bg-emerald-500/20 text-emerald-400' 
                  : violations.length < (exam.maxViolations || 3)
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-red-500/20 text-red-400'
              }`}>
                <span>{violations.length === 0 ? '🔒' : '⚠️'}</span>
                <span className="font-medium">
                  {violations.length === 0 ? 'Secure' : `${violations.length} warning${violations.length > 1 ? 's' : ''}`}
                </span>
              </div>

              {/* Timer */}
              <div className="bg-gradient-to-r from-red-600 to-orange-600 px-4 py-2 rounded-lg shadow-lg">
                <Timer 
                  duration={exam.duration} 
                  onTimeUp={handleSubmit} 
                  initialTime={timeRemaining > 0 ? timeRemaining : null}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Warning Toast */}
      {showWarning && (
        <div className="fixed top-20 right-4 bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl z-50 animate-pulse border border-red-500">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <span className="font-semibold">{warningMessage}</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Question Panel - Main Area */}
          <div className="lg:col-span-3">
            {/* Question Card */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl">
              {/* Question Header */}
              <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 border-b border-slate-600">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                      <span className="text-xl font-bold">{currentQuestion + 1}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Question</span>
                      <p className="text-white font-semibold">{currentQuestion + 1} of {exam.questions.length}</p>
                    </div>
                  </div>
                  
                  {question.category && (
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                        question.category === 'Java' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                        question.category === 'DSA' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                        question.category === 'DBMS' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                        question.category === 'SQL' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                        question.category === 'OS' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        question.category === 'Computer Networks' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}>
                        {question.category}
                      </span>
                      {question.difficulty && (
                        <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          question.difficulty === 'Easy' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          question.difficulty === 'Medium' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                          'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {question.difficulty}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Question Content */}
              <div className="p-6">
                <h2 className="text-xl font-medium text-white leading-relaxed mb-8">
                  {question.prompt || question.question}
                </h2>

                {/* Options */}
                {question.options && question.options.length > 0 && (
                  <div className="space-y-4">
                    {question.options.map((option, index) => {
                      const questionKey = question.questionIndex !== undefined ? question.questionIndex : currentQuestion;
                      const isSelected = answers[questionKey] === index;
                      const optionLetter = String.fromCharCode(65 + index);
                      
                      return (
                        <button
                          key={index}
                          onClick={() => handleAnswerChange(questionKey, index)}
                          className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 group ${
                            isSelected 
                              ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/20' 
                              : 'bg-slate-700/50 border-slate-600 hover:border-slate-500 hover:bg-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg transition-all ${
                              isSelected 
                                ? 'bg-indigo-500 text-white' 
                                : 'bg-slate-600 text-slate-300 group-hover:bg-slate-500'
                            }`}>
                              {optionLetter}
                            </div>
                            <span className={`text-lg ${isSelected ? 'text-white font-medium' : 'text-slate-300'}`}>
                              {option}
                            </span>
                            {isSelected && (
                              <div className="ml-auto">
                                <span className="text-indigo-400 text-xl">✓</span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Navigation Footer */}
              <div className="bg-slate-700/50 px-6 py-4 border-t border-slate-600">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setCurrentQuestion(Math.max(0, currentQuestion - 1))}
                    disabled={currentQuestion === 0}
                    className="flex items-center gap-2 px-5 py-2.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-all font-medium disabled:cursor-not-allowed"
                  >
                    <span>←</span>
                    <span>Previous</span>
                  </button>

                  <div className="text-sm text-slate-400">
                    Use <kbd className="px-2 py-1 bg-slate-600 rounded text-xs mx-1">←</kbd> <kbd className="px-2 py-1 bg-slate-600 rounded text-xs mx-1">→</kbd> keys to navigate
                  </div>

                  <div className="flex items-center gap-3">
                    {currentQuestion < exam.questions.length - 1 ? (
                      <button
                        onClick={() => setCurrentQuestion(currentQuestion + 1)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all font-medium shadow-lg"
                      >
                        <span>Next</span>
                        <span>→</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleSubmit}
                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white rounded-lg transition-all font-bold shadow-lg"
                      >
                        <span>Submit Exam</span>
                        <span>✓</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar - Question Navigator */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-xl sticky top-24">
              {/* Sidebar Header */}
              <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-4 py-3 border-b border-slate-600">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <span>📋</span>
                  Question Navigator
                </h3>
              </div>

              {/* Question Grid */}
              <div className="p-4">
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {exam.questions.map((q, index) => {
                    const questionKey = q.questionIndex !== undefined ? q.questionIndex : index;
                    const isAnswered = answers[questionKey] !== undefined;
                    const isCurrent = currentQuestion === index;
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleQuestionClick(index)}
                        className={`w-10 h-10 rounded-lg font-semibold text-sm transition-all ${
                          isCurrent 
                            ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-800' 
                            : isAnswered 
                              ? 'bg-emerald-600/80 text-white hover:bg-emerald-500' 
                              : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                        }`}
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="border-t border-slate-600 pt-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-4 h-4 rounded bg-emerald-600"></div>
                    <span className="text-slate-400">Answered ({answeredCount})</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-4 h-4 rounded bg-slate-600"></div>
                    <span className="text-slate-400">Not Answered ({exam.questions.length - answeredCount})</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-4 h-4 rounded bg-indigo-600 ring-2 ring-indigo-400"></div>
                    <span className="text-slate-400">Current</span>
                  </div>
                </div>

                {/* Security Status */}
                <div className={`mt-4 p-3 rounded-lg ${
                  violations.length === 0 
                    ? 'bg-emerald-500/10 border border-emerald-500/30' 
                    : 'bg-amber-500/10 border border-amber-500/30'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span>{violations.length === 0 ? '🔒' : '⚠️'}</span>
                    <span className={`font-semibold text-sm ${violations.length === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {violations.length === 0 ? 'Exam Secure' : 'Warnings Detected'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {violations.length === 0 
                      ? 'No suspicious activity detected' 
                      : `${violations.length}/${exam.maxViolations || 3} warnings issued`
                    }
                  </p>
                </div>

                {/* Submit Button (Always visible) */}
                <button
                  onClick={handleSubmit}
                  className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white rounded-xl font-bold transition-all shadow-lg"
                >
                  Submit Exam
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
