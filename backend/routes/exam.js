const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const axios = require("axios");
const authMiddleware = require("../middleware/authMiddleware");
const Exam = require("../models/Exam");
const Answer = require("../models/Answer");
const Violation = require("../models/Violation");

const router = express.Router();

// Configure multer for CSV file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv") || 
        file.mimetype === "application/json" || file.originalname.endsWith(".json")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV and JSON files are allowed"));
    }
  },
});

// Parse CSV content to questions array
const parseCSV = (csvContent) => {
  const lines = csvContent.split("\n").filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one question");
  }

  const header = lines[0].toLowerCase().split(",").map(h => h.trim());
  
  // Column name mappings for different CSV formats
  const columnMappings = {
    question: ["question", "topics", "prompt", "text", "q"],
    option1: ["option1", "option a", "optiona", "a", "choice1"],
    option2: ["option2", "option b", "optionb", "b", "choice2"],
    option3: ["option3", "option c", "optionc", "c", "choice3"],
    option4: ["option4", "option d", "optiond", "d", "choice4"],
    correct: ["correct_answer", "correct answer", "answer", "correct", "correctanswer"],
    category: ["category", "topics", "topic", "subject", "type"],
    difficulty: ["difficulty", "level", "diff"]
  };

  // Find matching column index for each field
  const findColumn = (mappings) => {
    for (const name of mappings) {
      const idx = header.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const questionIdx = findColumn(columnMappings.question);
  const opt1Idx = findColumn(columnMappings.option1);
  const opt2Idx = findColumn(columnMappings.option2);
  const opt3Idx = findColumn(columnMappings.option3);
  const opt4Idx = findColumn(columnMappings.option4);
  const correctIdx = findColumn(columnMappings.correct);
  const categoryIdx = findColumn(columnMappings.category);
  const difficultyIdx = findColumn(columnMappings.difficulty);

  // Check required columns
  if (questionIdx === -1 && opt1Idx === -1) {
    // If first column is topic/category, second column is likely question
    // Handle format: TOPICS, Question, Option A, Option B, Option C, Option D, Correct Answer
    const topicsIdx = header.indexOf("topics");
    if (topicsIdx !== -1 && header.length >= 7) {
      // Custom handling for this specific format
      return parseTopicBasedCSV(lines, header);
    }
    throw new Error("Could not identify question column in CSV");
  }

  const questions = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 5) continue;

    const question = questionIdx !== -1 ? values[questionIdx]?.trim() : "";
    const options = [
      opt1Idx !== -1 ? values[opt1Idx]?.trim() : "",
      opt2Idx !== -1 ? values[opt2Idx]?.trim() : "",
      opt3Idx !== -1 ? values[opt3Idx]?.trim() : "",
      opt4Idx !== -1 ? values[opt4Idx]?.trim() : ""
    ].filter(Boolean);

    if (!question || options.length < 2) continue;

    const correctValue = correctIdx !== -1 ? values[correctIdx]?.trim() : "";
    let correctIndex = parseInt(correctValue, 10);
    
    if (isNaN(correctIndex)) {
      // Try matching A/B/C/D or option text
      if (/^[A-D]$/i.test(correctValue)) {
        correctIndex = correctValue.toUpperCase().charCodeAt(0) - 65;
      } else {
        correctIndex = options.findIndex(opt => 
          opt.toLowerCase() === correctValue.toLowerCase()
        );
      }
    } else {
      correctIndex = correctIndex - 1; // Convert 1-based to 0-based
    }

    if (correctIndex < 0 || correctIndex >= options.length) {
      console.warn(`Skipping row ${i + 1}: Invalid correct answer "${correctValue}"`);
      continue;
    }

    questions.push({
      prompt: question,
      options,
      correctOptionIndex: correctIndex,
      category: categoryIdx !== -1 ? values[categoryIdx]?.trim() || "General" : "General",
      difficulty: difficultyIdx !== -1 ? values[difficultyIdx]?.trim() || "medium" : "medium",
    });
  }

  return questions;
};

// Parse CSV format: TOPICS, Question, Option A, Option B, Option C, Option D, Correct Answer
const parseTopicBasedCSV = (lines, header) => {
  const questions = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 7) continue;

    const [category, question, optA, optB, optC, optD, correct] = values.map(v => v?.trim() || "");
    
    if (!question || !optA) continue;

    const options = [optA, optB, optC, optD].filter(Boolean);
    
    let correctIndex = -1;
    if (/^[A-D]$/i.test(correct)) {
      correctIndex = correct.toUpperCase().charCodeAt(0) - 65;
    } else {
      correctIndex = parseInt(correct, 10) - 1;
    }

    if (correctIndex < 0 || correctIndex >= options.length) {
      console.warn(`Skipping row ${i + 1}: Invalid correct answer "${correct}"`);
      continue;
    }

    questions.push({
      prompt: question,
      options,
      correctOptionIndex: correctIndex,
      category: category || "General",
      difficulty: "medium",
    });
  }

  return questions;
};

// Helper to parse CSV line (handles quoted values)
const parseCSVLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;
  
  for (let char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  
  return values.map(v => v.replace(/^"|"$/g, "").trim());
};

const sanitizeQuestion = (question, index) => ({
  questionIndex: index,
  prompt: question.prompt,
  options: question.options,
  category: question.category,
  difficulty: question.difficulty,
});

const sanitizeExamMeta = (exam) => ({
  id: exam._id,
  title: exam.title,
  company: exam.company,
  type: exam.type,
  description: exam.description,
  duration: exam.duration,
  maxViolations: exam.maxViolations,
  passingPercentage: exam.passingPercentage,
  instructions: exam.instructions,
  questionCount: exam.questions.length,
  isActive: exam.isActive,
  createdAt: exam.createdAt,
  updatedAt: exam.updatedAt,
});

const validateObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// Create exam directly via JSON body
router.post("/", authMiddleware, async (req, res) => {
  try {
    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const {
      title,
      description,
      duration,
      passingPercentage = 60,
      maxViolations = 3,
      instructions,
      questions,
      company = "General",
      type = "PLACEMENT_QUIZ"
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Exam title is required" });
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "At least one question is required" });
    }

    if (!duration || duration <= 0) {
      return res.status(400).json({ error: "Valid duration is required" });
    }

    // Normalize questions to our format
    const normalizedQuestions = questions.map((q, index) => {
      const prompt = q.prompt || q.question || q.questionText || q.text;
      const options = q.options || [q.option1, q.option2, q.option3, q.option4].filter(Boolean);
      
      let correctIndex = -1;
      if (typeof q.correctOptionIndex === "number") {
        correctIndex = q.correctOptionIndex;
      } else if (typeof q.correct === "number") {
        correctIndex = q.correct;
      } else if (typeof q.correctAnswer === "string") {
        correctIndex = options.findIndex(opt => 
          opt.toLowerCase() === q.correctAnswer.toLowerCase()
        );
      } else if (typeof q.correctAnswer === "number") {
        correctIndex = q.correctAnswer;
      }

      if (!prompt) {
        throw new Error(`Question ${index + 1} is missing a question text`);
      }

      if (options.length < 2) {
        throw new Error(`Question ${index + 1} must have at least 2 options`);
      }

      if (correctIndex < 0 || correctIndex >= options.length) {
        throw new Error(`Question ${index + 1} has an invalid correct answer`);
      }

      return {
        prompt: prompt.trim(),
        options: options.map(o => String(o).trim()),
        correctOptionIndex: correctIndex,
        category: q.category || "General",
        difficulty: q.difficulty || "Medium",
        explanation: q.explanation || "",
      };
    });

    const exam = await Exam.create({
      title: title.trim(),
      description: description || `Exam with ${normalizedQuestions.length} questions`,
      duration: parseInt(duration, 10),
      passingPercentage: parseInt(passingPercentage, 10),
      maxViolations: parseInt(maxViolations, 10),
      instructions: Array.isArray(instructions) ? instructions : 
        (instructions ? [instructions] : ["Answer all questions carefully."]),
      questions: normalizedQuestions,
      company,
      type,
      instructor: req.userId,
      isActive: true,
    });

    res.status(201).json({
      message: `Exam created successfully with ${normalizedQuestions.length} questions`,
      exam: sanitizeExamMeta(exam),
    });
  } catch (error) {
    console.error("Create exam error:", error);
    res.status(400).json({ error: error.message || "Failed to create exam" });
  }
});

// Import exam from CSV file
router.post("/import-csv", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { title, duration, passingPercentage, instructions, description } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Exam title is required" });
    }

    const fileContent = req.file.buffer.toString("utf-8");
    let questions;

    if (req.file.originalname.endsWith(".json")) {
      // Parse JSON
      const jsonData = JSON.parse(fileContent);
      questions = jsonData.questions || jsonData;
      
      // Normalize JSON questions to our format
      questions = questions.map((q, idx) => ({
        prompt: q.prompt || q.question || q.questionText,
        options: q.options || [q.option1, q.option2, q.option3, q.option4],
        correctOptionIndex: typeof q.correctOptionIndex === "number" 
          ? q.correctOptionIndex 
          : (q.correct !== undefined ? q.correct : parseInt(q.correctAnswer, 10) - 1),
        category: q.category || "General",
        difficulty: q.difficulty || "medium",
      }));
    } else {
      // Parse CSV
      questions = parseCSV(fileContent);
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: "No valid questions found in file" });
    }

    const exam = await Exam.create({
      title,
      description: description || `Imported exam with ${questions.length} questions`,
      duration: parseInt(duration, 10) || 60,
      passingPercentage: parseInt(passingPercentage, 10) || 60,
      instructions: instructions || "Answer all questions carefully.",
      questions,
      instructor: req.userId,
      isActive: true,
    });

    res.status(201).json({
      message: `Exam created successfully with ${questions.length} questions`,
      exam: sanitizeExamMeta(exam),
    });
  } catch (error) {
    console.error("CSV import error:", error);
    res.status(500).json({ error: error.message || "Failed to import exam" });
  }
});

// Import exam from URL (JSON or CSV)
router.post("/import-url", authMiddleware, async (req, res) => {
  try {
    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const { url, title, duration, passingPercentage, instructions, description } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    if (!title) {
      return res.status(400).json({ error: "Exam title is required" });
    }

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Fetch content from URL
    let response;
    try {
      response = await axios.get(url, { 
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024, // 10MB limit
        headers: {
          "User-Agent": "SEB-Lite-Exam-Importer/1.0",
        },
      });
    } catch (fetchError) {
      return res.status(400).json({ 
        error: `Failed to fetch URL: ${fetchError.message}` 
      });
    }

    const content = typeof response.data === "string" 
      ? response.data 
      : JSON.stringify(response.data);
    
    let questions;
    const isJSON = url.endsWith(".json") || 
                   response.headers["content-type"]?.includes("application/json") ||
                   content.trim().startsWith("{") || 
                   content.trim().startsWith("[");

    if (isJSON) {
      // Parse JSON
      const jsonData = typeof response.data === "string" 
        ? JSON.parse(content) 
        : response.data;
      
      questions = jsonData.questions || (Array.isArray(jsonData) ? jsonData : []);
      
      // Normalize JSON questions
      questions = questions.map((q) => ({
        prompt: q.prompt || q.question || q.questionText,
        options: q.options || [q.option1, q.option2, q.option3, q.option4],
        correctOptionIndex: typeof q.correctOptionIndex === "number" 
          ? q.correctOptionIndex 
          : (q.correct !== undefined ? q.correct : parseInt(q.correctAnswer, 10) - 1),
        category: q.category || "General",
        difficulty: q.difficulty || "medium",
      }));
    } else {
      // Parse CSV
      questions = parseCSV(content);
    }

    if (questions.length === 0) {
      return res.status(400).json({ error: "No valid questions found at URL" });
    }

    const exam = await Exam.create({
      title,
      description: description || `Imported from URL with ${questions.length} questions`,
      duration: parseInt(duration, 10) || 60,
      passingPercentage: parseInt(passingPercentage, 10) || 60,
      instructions: instructions || "Answer all questions carefully.",
      questions,
      instructor: req.userId,
      isActive: true,
      sourceUrl: url,
    });

    res.status(201).json({
      message: `Exam created successfully with ${questions.length} questions from URL`,
      exam: sanitizeExamMeta(exam),
    });
  } catch (error) {
    console.error("URL import error:", error);
    res.status(500).json({ error: error.message || "Failed to import exam from URL" });
  }
});

// Student dashboard view of available/completed exams
router.get("/available", authMiddleware, async (req, res) => {
  try {
    const [activeExams, attempts] = await Promise.all([
      Exam.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
      Answer.find({ studentId: req.userId }).lean(),
    ]);

    const attemptedMap = new Map();
    attempts.forEach((attempt) => {
      attemptedMap.set(String(attempt.examId), attempt);
    });

    const available = [];
    const completed = [];
    const examMetaById = new Map();

    activeExams.forEach((exam) => {
      const meta = sanitizeExamMeta(exam);
      examMetaById.set(String(exam._id), meta);

      const attempt = attemptedMap.get(String(exam._id));
      if (!attempt || attempt.status === "in-progress") {
        available.push({
          ...meta,
          hasCompleted: false,
          canTake: exam.isActive,
        });
      } else {
        completed.push({
          examId: exam._id,
          title: exam.title,
          submittedAt: attempt.submittedAt,
          score: attempt.percentage,
          correctAnswers: attempt.correctAnswers,
          totalQuestions: attempt.totalQuestions,
          passed: attempt.percentage >= exam.passingPercentage,
          status: attempt.status,
        });
      }
    });

    // Include completed exams that might no longer be active
    const completedIds = attempts
      .filter((attempt) => attempt.status !== "in-progress")
      .map((attempt) => attempt.examId);

    const missingExamIds = completedIds.filter(
      (id) => !examMetaById.has(String(id))
    );

    if (missingExamIds.length) {
      const pastExams = await Exam.find({ _id: { $in: missingExamIds } })
        .select("title passingPercentage questions")
        .lean();
      pastExams.forEach((exam) => {
        examMetaById.set(String(exam._id), sanitizeExamMeta(exam));
      });
    }

    const completedDetailed = attempts
      .filter((attempt) => attempt.status !== "in-progress")
      .map((attempt) => {
        const exam = examMetaById.get(String(attempt.examId));
        const passingPercentage = exam?.passingPercentage ?? 60;
        return {
          examId: attempt.examId,
          title: exam?.title ?? "Exam",
          submittedAt: attempt.submittedAt,
          score: attempt.percentage,
          correctAnswers: attempt.correctAnswers,
          totalQuestions: attempt.totalQuestions,
          passed: attempt.percentage >= passingPercentage,
          grade:
            attempt.percentage >= 90
              ? "A"
              : attempt.percentage >= 80
              ? "B"
              : attempt.percentage >= 70
              ? "C"
              : attempt.percentage >= 60
              ? "D"
              : "F",
        };
      });

    const avgScore = completedDetailed.length
      ? completedDetailed.reduce((sum, entry) => sum + entry.score, 0) /
        completedDetailed.length
      : 0;

    res.json({
      available,
      completed: completedDetailed,
      stats: {
        totalAvailable: available.length,
        totalCompleted: completedDetailed.length,
        averageScore: Number(avgScore.toFixed(2)),
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load exam dashboard." });
  }
});

// Instructor/Admin list of exams
router.get("/", authMiddleware, async (req, res) => {
  try {
    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const match = req.role === "instructor" ? { instructor: req.userId } : {};
    const exams = await Exam.find(match).sort({ createdAt: -1 }).lean();
    const examIds = exams.map((exam) => exam._id);

    const analytics = await Answer.aggregate([
      { $match: { examId: { $in: examIds } } },
      {
        $group: {
          _id: "$examId",
          attempts: { $sum: 1 },
          submitted: {
            $sum: {
              $cond: [{ $in: ["$status", ["submitted", "auto-submitted"]] }, 1, 0],
            },
          },
          avgScore: { $avg: "$percentage" },
        },
      },
    ]);

    const analyticsMap = new Map();
    analytics.forEach((entry) => {
      analyticsMap.set(String(entry._id), entry);
    });

    const response = exams.map((exam) => {
      const meta = sanitizeExamMeta(exam);
      const examAnalytics = analyticsMap.get(String(exam._id)) || {
        attempts: 0,
        submitted: 0,
        avgScore: 0,
      };

      return {
        ...meta,
        totalQuestions: exam.questions.length,
        enrolledStudents: examAnalytics.attempts,
        submittedAttempts: examAnalytics.submitted,
        averageScore: Number((examAnalytics.avgScore || 0).toFixed(2)),
        status: exam.isActive ? "Active" : "Inactive",
      };
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to load exams." });
  }
});

// Start exam: return sanitized questions and ensure attempt exists
router.get("/:id/start", authMiddleware, async (req, res) => {
  try {
    console.log('Start exam request - ID:', req.params.id, 'User:', req.userId);
    
    if (!validateObjectId(req.params.id)) {
      console.log('Invalid exam ID:', req.params.id);
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) {
      console.log('Exam not found:', req.params.id);
      return res.status(404).json({ error: "Exam not found." });
    }

    console.log('Found exam:', exam.title, 'Active:', exam.isActive);

    if (!exam.isActive) {
      console.log('Exam not active');
      return res.status(403).json({ error: "Exam is not currently active." });
    }

    const existingAttempt = await Answer.findOne({
      examId: req.params.id,
      studentId: req.userId,
    });

    if (existingAttempt && existingAttempt.status !== "in-progress") {
      return res
        .status(403)
        .json({ error: "You have already submitted this exam." });
    }

    let attempt = existingAttempt;
    if (!attempt) {
      attempt = await Answer.create({
        studentId: req.userId,
        examId: exam._id,
        totalQuestions: exam.questions.length,
        timeRemaining: exam.duration * 60,
      });
    }

    const sanitizedQuestions = exam.questions.map((question, index) =>
      sanitizeQuestion(question, index)
    );

    res.json({
      exam: sanitizeExamMeta(exam),
      questions: sanitizedQuestions,
      progress: {
        answers: (attempt.answers || []).map((item) => ({
          questionIndex: item.questionIndex,
          selectedOption: item.selectedOption,
          timeSpent: item.timeSpent,
        })),
        timeRemaining: attempt.timeRemaining ?? exam.duration * 60,
        startedAt: attempt.startedAt,
        lastSavedAt: attempt.lastSavedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to start exam." });
  }
});

// Student fetch results
router.get("/:examId/results", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.examId)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const record = await Answer.findOne({
      examId: req.params.examId,
      studentId: req.userId,
    })
      .populate("examId", "title passingPercentage duration")
      .lean();

    if (!record || !["submitted", "auto-submitted"].includes(record.status)) {
      return res.status(404).json({ error: "No submitted attempt found." });
    }

    const exam = record.examId;
    const passed = record.percentage >= (exam?.passingPercentage ?? 60);

    res.json({
      exam: {
        id: exam?._id ?? req.params.examId,
        title: exam?.title ?? "Exam",
        passingPercentage: exam?.passingPercentage ?? 60,
      },
      score: record.percentage,
      correctAnswers: record.correctAnswers,
      totalQuestions: record.totalQuestions,
      submittedAt: record.submittedAt,
      passed,
      grade:
        record.percentage >= 90
          ? "A"
          : record.percentage >= 80
          ? "B"
          : record.percentage >= 70
          ? "C"
          : record.percentage >= 60
          ? "D"
          : "F",
      durationUsed: record.durationUsed,
      violationsCount: record.violationsCount,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch results." });
  }
});

// Instructor/Admin results summary per exam
router.get("/:examId/summary", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.examId)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const exam = await Exam.findById(req.params.examId).lean();
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    if (req.role === "instructor" && String(exam.instructor) !== req.userId) {
      return res.status(403).json({ error: "Not authorized to view this exam." });
    }

    const attempts = await Answer.find({ examId: req.params.examId })
      .select(
        "studentId status percentage correctAnswers totalQuestions submittedAt autoSubmitted autoSubmitReason"
      )
      .populate("studentId", "name email")
      .lean();

    const violations = await Violation.countDocuments({ examId: req.params.examId });

    res.json({
      exam: sanitizeExamMeta(exam),
      attempts,
      violationCount: violations,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch summary." });
  }
});

// Exam summary for instruction screen
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    if (!exam.isActive && req.role === "student") {
      return res.status(403).json({ error: "Exam is not active." });
    }

    const attempt = await Answer.findOne({
      examId: req.params.id,
      studentId: req.userId,
    })
      .select("status submittedAt timeRemaining")
      .lean();

    res.json({
      ...sanitizeExamMeta(exam),
      alreadyAttempted: attempt ? attempt.status !== "in-progress" : false,
      attemptStatus: attempt?.status ?? null,
      submittedAt: attempt?.submittedAt ?? null,
      timeRemaining: attempt?.timeRemaining ?? exam.duration * 60,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch exam." });
  }
});

// Submit exam answers
router.post("/:id/submit", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    const attempt = await Answer.findOne({
      examId: req.params.id,
      studentId: req.userId,
    });

    if (!attempt) {
      return res.status(404).json({ error: "No active attempt found." });
    }

    if (attempt.status !== "in-progress") {
      return res.status(400).json({ error: "Exam already submitted." });
    }

    const { answers = [], violations = 0 } = req.body;

    // Process answers
    const processedAnswers = answers.map((ans) => ({
      questionIndex: ans.questionIndex,
      selectedOption: typeof ans.selectedOption === "number" ? ans.selectedOption : null,
      timeSpent: ans.timeSpent || 0,
    }));

    // Calculate score
    let correctCount = 0;
    processedAnswers.forEach((ans) => {
      if (ans.selectedOption !== null && ans.questionIndex < exam.questions.length) {
        const question = exam.questions[ans.questionIndex];
        if (question && ans.selectedOption === question.correctOptionIndex) {
          correctCount++;
        }
      }
    });

    const totalQuestions = exam.questions.length;
    const percentage = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
    const passed = percentage >= (exam.passingPercentage || 60);

    // Update attempt
    attempt.answers = processedAnswers;
    attempt.correctAnswers = correctCount;
    attempt.totalQuestions = totalQuestions;
    attempt.percentage = percentage;
    attempt.status = "submitted";
    attempt.submittedAt = new Date();
    attempt.violationsCount = violations;

    await attempt.save();

    res.json({
      message: "Exam submitted successfully",
      score: percentage,
      correctAnswers: correctCount,
      totalQuestions,
      passed,
    });
  } catch (error) {
    console.error("Submit exam error:", error);
    res.status(500).json({ error: "Failed to submit exam." });
  }
});

// Update exam (toggle active status, update settings)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    // Check ownership for instructors
    if (req.role === "instructor" && String(exam.instructor) !== req.userId) {
      return res.status(403).json({ error: "Not authorized to modify this exam." });
    }

    const { isActive, maxViolations, duration, passingPercentage, title, description } = req.body;

    // Update allowed fields
    if (typeof isActive === "boolean") {
      exam.isActive = isActive;
    }
    if (maxViolations !== undefined) {
      exam.maxViolations = Number(maxViolations);
    }
    if (duration !== undefined) {
      exam.duration = Number(duration);
    }
    if (passingPercentage !== undefined) {
      exam.passingPercentage = Number(passingPercentage);
    }
    if (title) {
      exam.title = title.trim();
    }
    if (description !== undefined) {
      exam.description = description;
    }

    await exam.save();

    res.json({
      message: "Exam updated successfully",
      exam: sanitizeExamMeta(exam),
    });
  } catch (error) {
    console.error("Update exam error:", error);
    res.status(500).json({ error: "Failed to update exam." });
  }
});

// Delete exam
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    if (!validateObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    if (!["instructor", "admin"].includes(req.role)) {
      return res.status(403).json({ error: "Instructor or admin access required." });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    // Check ownership for instructors
    if (req.role === "instructor" && String(exam.instructor) !== req.userId) {
      return res.status(403).json({ error: "Not authorized to delete this exam." });
    }

    await Exam.findByIdAndDelete(req.params.id);

    // Also delete related answers and violations
    await Answer.deleteMany({ examId: req.params.id });
    await Violation.deleteMany({ examId: req.params.id });

    res.json({ message: "Exam deleted successfully" });
  } catch (error) {
    console.error("Delete exam error:", error);
    res.status(500).json({ error: "Failed to delete exam." });
  }
});

module.exports = router;
