import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS, axiosConfig } from "../utils/api";
import { getUser, getAccessToken, clearAuth, isAuthenticated } from "../utils/auth";

export default function InstructorDashboard() {
  const [exams, setExams] = useState([]);
  const [violations, setViolations] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState('exams');
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState({ type: '', text: '' });
  const [importForm, setImportForm] = useState({
    title: '',
    duration: 60,
    passingPercentage: 60,
    maxViolations: 3,
    description: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewExam, setPreviewExam] = useState(null);
  const fileInputRef = useRef(null);
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
      const [examsRes, violationsRes, statsRes] = await Promise.all([
        axios.get(API_ENDPOINTS.EXAMS, authConfig),
        axios.get(`${API_ENDPOINTS.VIOLATIONS}?limit=10`, authConfig),
        axios.get(`${API_ENDPOINTS.VIOLATION_STATS}?timeframe=24h`, authConfig)
      ]);

      setExams(examsRes.data?.exams || examsRes.data || []);
      setViolations(violationsRes.data?.violations || violationsRes.data || []);
      setStats(statsRes.data || {});
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      if (err.response?.status === 401) {
        setError("Session expired. Please login again.");
        setTimeout(() => {
          clearAuth();
          navigate("/login");
        }, 2000);
      } else {
        setError("Failed to load dashboard. Please try again.");
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
    if (user.role && !['instructor', 'admin'].includes(user.role)) {
      navigate("/student-dashboard");
      return;
    }
    fetchDashboardData();
  }, [token, user.role, navigate, fetchDashboardData]);

  const handleLogout = () => {
    clearAuth();
    navigate("/login");
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

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      // Auto-fill title from filename
      if (!importForm.title) {
        const name = file.name.replace(/\.(csv|json)$/i, '').replace(/[-_]/g, ' ');
        setImportForm(prev => ({ ...prev, title: name }));
      }
    }
  };

  // Handle CSV/JSON import
  const handleImport = async () => {
    if (!selectedFile || !importForm.title) {
      setImportMessage({ type: 'error', text: 'Please select a file and provide a title' });
      return;
    }

    setImportLoading(true);
    setImportMessage({ type: '', text: '' });

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', importForm.title);
      formData.append('duration', importForm.duration);
      formData.append('passingPercentage', importForm.passingPercentage);
      formData.append('maxViolations', importForm.maxViolations);
      formData.append('description', importForm.description);

      const response = await axios.post(
        `${API_ENDPOINTS.EXAMS}/import-csv`,
        formData,
        {
          ...authConfig,
          headers: {
            ...authConfig.headers,
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      setImportMessage({ 
        type: 'success', 
        text: response.data.message || 'Exam imported successfully!' 
      });
      
      // Reset form
      setSelectedFile(null);
      setImportForm({ title: '', duration: 60, passingPercentage: 60, maxViolations: 3, description: '' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Refresh exams list
      fetchDashboardData();
      
      // Switch back to exams tab after a delay
      setTimeout(() => {
        setActiveTab('exams');
        setImportMessage({ type: '', text: '' });
      }, 2000);
    } catch (err) {
      console.error('Import failed:', err);
      setImportMessage({ 
        type: 'error', 
        text: err.response?.data?.error || 'Failed to import exam. Please check your file format.' 
      });
    } finally {
      setImportLoading(false);
    }
  };

  // Delete exam
  const handleDeleteExam = async (examId) => {
    if (!window.confirm('Are you sure you want to delete this exam? This action cannot be undone.')) {
      return;
    }

    try {
      await axios.delete(`${API_ENDPOINTS.EXAMS}/${examId}`, authConfig);
      fetchDashboardData();
    } catch (err) {
      console.error('Failed to delete exam:', err);
      alert('Failed to delete exam: ' + (err.response?.data?.error || 'Unknown error'));
    }
  };

  // Preview exam questions
  const handlePreviewExam = async (examId) => {
    try {
      const response = await axios.get(`${API_ENDPOINTS.EXAMS}/${examId}`, authConfig);
      setPreviewExam(response.data.exam || response.data);
    } catch (err) {
      console.error('Failed to load exam preview:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <div className="text-xl font-semibold text-gray-700">Loading dashboard...</div>
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
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">SEB Instructor Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">Welcome, {user.name}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                📝
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Exams</p>
                <p className="text-2xl font-bold text-gray-900">{exams.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                👥
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active Students</p>
                <p className="text-2xl font-bold text-gray-900">
                  {exams.reduce((acc, exam) => acc + exam.enrolledStudents, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                ⚠️
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Violations (24h)</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalCount || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                🚨
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">High Severity</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.stats?.find(s => s.severity === 'high')?.totalCount || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <nav className="flex space-x-1 bg-white rounded-lg p-1 shadow">
            {[
              { id: 'exams', label: 'My Exams', icon: '📝' },
              { id: 'violations', label: 'Recent Violations', icon: '⚠️' },
              { id: 'import', label: 'Import Exam', icon: '📤' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700 border-blue-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'exams' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">My Exams</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {exams.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No exams created yet. Click "Create Exam" to get started.
                </div>
              ) : (
                exams.map((exam) => (
                  <div key={exam._id || exam.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{exam.title}</h4>
                        <p className="text-sm text-gray-500">
                          {exam.totalQuestions} questions • {exam.duration} min • {exam.enrolledStudents} enrolled
                        </p>
                        <p className="text-xs text-gray-400">
                          Status: {exam.status} • Created: {formatDate(exam.createdAt)}
                        </p>
                      </div>
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => {
                            // Toggle exam active status
                            const toggleActive = async () => {
                              try {
                                const token = localStorage.getItem("token");
                                await axios.put(
                                  `${API_ENDPOINTS.EXAMS}/${exam._id || exam.id}`,
                                  { isActive: !exam.isActive },
                                  {
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                  }
                                );
                                fetchDashboardData();
                              } catch (err) {
                                console.error('Failed to toggle exam status:', err);
                              }
                            };
                            toggleActive();
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                            exam.isActive 
                              ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                              : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                          }`}
                        >
                          {exam.isActive ? '✓ Active' : 'Inactive'}
                        </button>
                        <button 
                          onClick={() => handlePreviewExam(exam._id || exam.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1 rounded-lg hover:bg-blue-50"
                        >
                          Preview
                        </button>
                        <button className="text-gray-600 hover:text-gray-800 text-sm font-medium px-3 py-1 rounded-lg hover:bg-gray-50">
                          View Results
                        </button>
                        <button 
                          onClick={() => handleDeleteExam(exam._id || exam.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium px-3 py-1 rounded-lg hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'violations' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Recent Violations</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {violations.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No violations detected in the last 24 hours.
                </div>
              ) : (
                violations.map((violation) => (
                  <div key={violation._id || violation.id} className="px-6 py-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            violation.severity === 'high' ? 'bg-red-100 text-red-800' :
                            violation.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {violation.severity}
                          </span>
                          <span className="ml-2 text-sm font-medium text-gray-900">
                            {violation.violationType.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {violation.student?.name} ({violation.student?.email})
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(violation.createdAt || violation.timestamp)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-900">{violation.description}</p>
                        {violation.exam && (
                          <p className="text-xs text-gray-500">{violation.exam.title}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Import Exam from CSV/JSON</h3>
            <p className="text-gray-600 mb-6">
              Upload a CSV or JSON file containing your exam questions. The system will automatically parse and create the exam.
            </p>

            {/* Import message */}
            {importMessage.text && (
              <div className={`mb-4 p-4 rounded-lg ${
                importMessage.type === 'success' 
                  ? 'bg-green-50 text-green-800 border border-green-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {importMessage.type === 'success' ? '✅' : '❌'} {importMessage.text}
              </div>
            )}

            {/* Import form */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exam Title *
                </label>
                <input
                  type="text"
                  value={importForm.title}
                  onChange={(e) => setImportForm({ ...importForm, title: e.target.value })}
                  placeholder="e.g., Java Programming Quiz"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={importForm.duration}
                    onChange={(e) => setImportForm({ ...importForm, duration: parseInt(e.target.value) || 60 })}
                    min="5"
                    max="180"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Passing %
                  </label>
                  <input
                    type="number"
                    value={importForm.passingPercentage}
                    onChange={(e) => setImportForm({ ...importForm, passingPercentage: parseInt(e.target.value) || 60 })}
                    min="0"
                    max="100"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Violations
                  </label>
                  <input
                    type="number"
                    value={importForm.maxViolations}
                    onChange={(e) => setImportForm({ ...importForm, maxViolations: parseInt(e.target.value) || 3 })}
                    min="1"
                    max="10"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={importForm.description}
                  onChange={(e) => setImportForm({ ...importForm, description: e.target.value })}
                  placeholder="Brief description of the exam..."
                  rows="2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upload File (CSV or JSON) *
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  onChange={handleFileSelect}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm text-green-600">
                    ✅ Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <button
                onClick={handleImport}
                disabled={importLoading || !selectedFile || !importForm.title}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-medium transition flex items-center justify-center"
              >
                {importLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Importing...
                  </>
                ) : (
                  <>📤 Import Exam</>
                )}
              </button>
            </div>

            {/* Format help */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">📋 CSV Format</h4>
                <pre className="text-xs text-blue-800 bg-blue-100 p-2 rounded overflow-x-auto">
{`question,option1,option2,option3,option4,correct_answer
"What is 2+2?",2,3,4,5,3
"Capital of France?",London,Paris,Berlin,Rome,2`}
                </pre>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-semibold text-green-900 mb-2">📋 JSON Format</h4>
                <pre className="text-xs text-green-800 bg-green-100 p-2 rounded overflow-x-auto">
{`{
  "questions": [
    {
      "question": "What is...",
      "options": ["A","B","C","D"],
      "correct": 0
    }
  ]
}`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewExam && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{previewExam.title}</h3>
                  <p className="text-gray-600">{previewExam.questions?.length || 0} questions • {previewExam.duration} min</p>
                </div>
                <button
                  onClick={() => setPreviewExam(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {previewExam.questions?.map((q, index) => (
                  <div key={index} className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-800 mb-2">
                      <span className="text-blue-600">Q{index + 1}.</span> {q.prompt || q.question}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {q.options?.map((opt, i) => (
                        <div 
                          key={i} 
                          className={`p-2 rounded ${
                            i === q.correctOptionIndex 
                              ? 'bg-green-100 text-green-800 font-medium' 
                              : 'bg-white text-gray-600'
                          }`}
                        >
                          {String.fromCharCode(65 + i)}. {opt}
                          {i === q.correctOptionIndex && ' ✓'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}