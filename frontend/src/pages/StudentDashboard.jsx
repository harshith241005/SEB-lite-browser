import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS, axiosConfig } from "../utils/api";
import { getUser, getAccessToken, clearAuth, isAuthenticated } from "../utils/auth";

export default function StudentDashboard() {
  const [availableExams, setAvailableExams] = useState([]);
  const [completedExams, setCompletedExams] = useState([]);
  const [stats, setStats] = useState({ totalAvailable: 0, totalCompleted: 0, averageScore: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState('available');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('title');
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const token = getAccessToken();
  const user = getUser() || {};

  // Configure axios with auth header
  const authConfig = useMemo(() => ({
    ...axiosConfig,
    headers: {
      ...axiosConfig.headers,
      Authorization: `Bearer ${token}`,
    },
  }), [token]);

  const fetchDashboardData = useCallback(async () => {
    try {
      setError("");
      const response = await axios.get(API_ENDPOINTS.EXAMS_AVAILABLE, authConfig);
      const data = response.data;

      setAvailableExams(data.available || []);
      setCompletedExams(data.completed || []);
      setStats(data.stats || { totalAvailable: 0, totalCompleted: 0, averageScore: 0 });
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      if (err.response?.status === 401) {
        setError("Session expired. Please login again.");
        setTimeout(() => {
          clearAuth();
          navigate("/login");
        }, 2000);
      } else {
        setError("Failed to load exams. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [authConfig, navigate]);

  useEffect(() => {
    if (!token || !isAuthenticated()) {
      navigate("/login");
      return;
    }
    if (user.role && user.role !== 'student') {
      navigate("/instructor-dashboard");
      return;
    }
    fetchDashboardData();
  }, [token, user.role, navigate, fetchDashboardData]);

  // Get unique categories from available exams
  const categories = useMemo(() => {
    const cats = new Set(availableExams.map(e => e.category || 'General'));
    return ['all', ...Array.from(cats)];
  }, [availableExams]);

  // Filter and sort exams
  const filteredExams = useMemo(() => {
    let exams = [...availableExams];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      exams = exams.filter(e => 
        (e.title || '').toLowerCase().includes(query) ||
        (e.category || '').toLowerCase().includes(query) ||
        (e.description || '').toLowerCase().includes(query)
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      exams = exams.filter(e => (e.category || 'General') === categoryFilter);
    }

    // Sort
    exams.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return (a.title || '').localeCompare(b.title || '');
        case 'duration':
          return (a.duration || 0) - (b.duration || 0);
        case 'questions':
          return (b.questionCount || b.totalQuestions || 0) - (a.questionCount || a.totalQuestions || 0);
        case 'difficulty':
          const diffOrder = { 'Easy': 1, 'Medium': 2, 'Hard': 3 };
          return (diffOrder[a.difficulty] || 2) - (diffOrder[b.difficulty] || 2);
        default:
          return 0;
      }
    });

    return exams;
  }, [availableExams, categoryFilter, sortBy, searchQuery]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
  };

  const handleTakeExam = (examId) => {
    navigate(`/exam-instructions/${examId}`);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDifficultyBadge = (difficulty) => {
    const styles = {
      'Easy': 'bg-green-100 text-green-800 border-green-200',
      'Medium': 'bg-yellow-100 text-yellow-800 border-yellow-200',
      'Hard': 'bg-red-100 text-red-800 border-red-200'
    };
    return styles[difficulty] || styles['Medium'];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
          <div className="text-xl font-semibold text-gray-700">Loading your dashboard...</div>
          <p className="text-gray-500 mt-2">Fetching available quizzes</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <p className="text-red-600 font-semibold mb-4">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setError("");
              fetchDashboardData();
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <div className="text-3xl mr-3">🎓</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">SEB-Lite Student Portal</h1>
                <p className="text-sm text-gray-500">Secure Examination Browser</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Welcome back,</p>
                <p className="font-semibold text-gray-900">{user.name || 'Student'}</p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition flex items-center"
              >
                <span className="mr-2">🚪</span> Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-500">
            <div className="flex items-center">
              <div className="p-3 bg-blue-100 rounded-xl text-2xl">📚</div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Available Quizzes</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalAvailable}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-green-500">
            <div className="flex items-center">
              <div className="p-3 bg-green-100 rounded-xl text-2xl">✅</div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Completed</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalCompleted}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-purple-500">
            <div className="flex items-center">
              <div className="p-3 bg-purple-100 rounded-xl text-2xl">📊</div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Average Score</p>
                <p className="text-3xl font-bold text-gray-900">{stats.averageScore?.toFixed(1) || 0}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <nav className="flex space-x-2 bg-white rounded-xl p-2 shadow-md">
            {[
              { id: 'available', label: 'Available Quizzes', icon: '📝', count: availableExams.length },
              { id: 'completed', label: 'My Results', icon: '🏆', count: completedExams.length }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-5 py-3 rounded-lg text-sm font-medium transition flex-1 justify-center ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="mr-2 text-lg">{tab.icon}</span>
                {tab.label}
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                  activeTab === tab.id ? 'bg-white/20' : 'bg-gray-200'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'available' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-md p-4">
              <div className="flex flex-col md:flex-row gap-4">
                {/* Search */}
                <div className="flex-1">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
                    <input
                      type="text"
                      placeholder="Search quizzes..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Category Filter */}
                <div className="md:w-48">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>
                        {cat === 'all' ? '📂 All Categories' : cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sort */}
                <div className="md:w-48">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    <option value="title">📝 Sort by Name</option>
                    <option value="duration">⏱️ Sort by Duration</option>
                    <option value="questions">❓ Sort by Questions</option>
                    <option value="difficulty">📈 Sort by Difficulty</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Quiz Cards */}
            {filteredExams.length === 0 ? (
              <div className="bg-white rounded-xl shadow-md p-12 text-center">
                <div className="text-6xl mb-4">📚</div>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  {searchQuery || categoryFilter !== 'all' ? 'No Matching Quizzes' : 'No Available Quizzes'}
                </h3>
                <p className="text-gray-500">
                  {searchQuery || categoryFilter !== 'all' 
                    ? 'Try adjusting your filters or search query.'
                    : 'Check back later for new quizzes.'
                  }
                </p>
                {(searchQuery || categoryFilter !== 'all') && (
                  <button
                    onClick={() => { setSearchQuery(''); setCategoryFilter('all'); }}
                    className="mt-4 text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredExams.map((exam) => (
                  <div 
                    key={exam._id || exam.id} 
                    className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 group"
                  >
                    {/* Card Header */}
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white">
                      <div className="flex justify-between items-start">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getDifficultyBadge(exam.difficulty || 'Medium')}`}>
                          {exam.difficulty || 'Medium'}
                        </span>
                        <span className="text-white/80 text-xs">
                          {exam.type?.replace('_', ' ') || 'QUIZ'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold mt-3 line-clamp-2 group-hover:underline">
                        {exam.title || 'Untitled Quiz'}
                      </h3>
                      {exam.category && (
                        <span className="inline-block mt-2 bg-white/20 px-2 py-0.5 rounded text-xs">
                          {exam.category}
                        </span>
                      )}
                    </div>

                    {/* Card Body */}
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="mr-2">⏱️</span>
                          <span>{exam.duration || 60} mins</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="mr-2">❓</span>
                          <span>{exam.questionCount || exam.totalQuestions || 'N/A'} questions</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="mr-2">🎯</span>
                          <span>Pass: {exam.passingPercentage || 40}%</span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="mr-2">⚠️</span>
                          <span>Max: {exam.maxViolations || 3} violations</span>
                        </div>
                      </div>

                      {exam.description && (
                        <p className="text-xs text-gray-500 mb-4 line-clamp-2">
                          {exam.description}
                        </p>
                      )}

                      <button
                        onClick={() => handleTakeExam(exam._id || exam.id)}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3 rounded-lg font-semibold transition-all flex items-center justify-center group"
                      >
                        <span className="mr-2 group-hover:animate-pulse">🚀</span>
                        Start Quiz
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Results Count */}
            {filteredExams.length > 0 && (
              <div className="text-center text-sm text-gray-500">
                Showing {filteredExams.length} of {availableExams.length} quizzes
              </div>
            )}
          </div>
        )}

        {activeTab === 'completed' && (
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                <span className="mr-2">🏆</span> My Quiz Results
              </h3>
              <p className="text-sm text-gray-600">Your performance on completed quizzes</p>
            </div>
            <div className="divide-y divide-gray-100">
              {completedExams.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="text-6xl mb-4">📝</div>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">No Results Yet</h3>
                  <p className="text-gray-500">Complete some quizzes to see your results here.</p>
                </div>
              ) : (
                completedExams.map((result, index) => (
                  <div key={result.examId || index} className="px-6 py-5 hover:bg-gray-50 transition">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center mb-3">
                          <h4 className="text-lg font-semibold text-gray-900 mr-3">
                            {result.title || 'Quiz'}
                          </h4>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                            result.passed 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {result.passed ? '✅ Passed' : '❌ Failed'}
                          </span>
                          {result.autoSubmitted && (
                            <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                              ⚠️ Auto-submitted
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-500 text-xs">Score</p>
                            <p className="font-bold text-xl text-indigo-600">{(result.score || 0).toFixed(1)}%</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-500 text-xs">Correct</p>
                            <p className="font-bold text-lg text-gray-900">
                              {result.correctAnswers || 0}/{result.totalQuestions || 0}
                            </p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-500 text-xs">Violations</p>
                            <p className="font-bold text-lg text-gray-900">{result.violationsCount || 0}</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-500 text-xs">Time Used</p>
                            <p className="font-bold text-lg text-gray-900">
                              {result.durationUsed ? Math.floor(result.durationUsed / 60) : 0} min
                            </p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-500 text-xs">Status</p>
                            <p className="font-bold text-sm text-gray-900">{result.status || 'Submitted'}</p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-3">
                          📅 Submitted: {formatDate(result.submittedAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>🔒 SEB-Lite - Secure Examination Browser | All exams are monitored</p>
        </div>
      </footer>
    </div>
  );
}
