const express = require("express");
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/authMiddleware");
const Exam = require("../models/Exam");
const Answer = require("../models/Answer");
const { evaluateSubmission, finalizeSubmission } = require("../services/submissionService");

const router = express.Router();

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalisePayloadAnswers = (answers) => {
  if (!Array.isArray(answers)) return [];
  return answers
    .filter((entry) => entry && typeof entry.questionIndex === "number")
    .map((entry) => ({
      questionIndex: entry.questionIndex,
      selectedOption:
        typeof entry.selectedOption === "number" ? entry.selectedOption : null,
      timeSpent: typeof entry.timeSpent === "number" ? entry.timeSpent : 0,
    }));
};

router.get("/:examId/progress", authMiddleware, async (req, res) => {
  try {
    const { examId } = req.params;
    if (!isValidObjectId(examId)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const attempt = await Answer.findOne({
      examId,
      studentId: req.userId,
    })
      .select("answers status timeRemaining startedAt lastSavedAt")
      .lean();

    if (!attempt) {
      return res.status(404).json({ error: "No saved progress found." });
    }

    res.json({
      status: attempt.status,
      answers: attempt.answers.map((entry) => ({
        questionIndex: entry.questionIndex,
        selectedOption: entry.selectedOption,
        timeSpent: entry.timeSpent,
      })),
      timeRemaining: attempt.timeRemaining,
      startedAt: attempt.startedAt,
      lastSavedAt: attempt.lastSavedAt,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load progress." });
  }
});

router.post("/save", authMiddleware, async (req, res) => {
  try {
    const { examId, answers, timeRemaining } = req.body;

    if (!isValidObjectId(examId)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const exam = await Exam.findById(examId)
      .select("duration questions isActive")
      .lean();

    if (!exam || (!exam.isActive && req.role === "student")) {
      return res.status(404).json({ error: "Exam not available." });
    }

    let attempt = await Answer.findOne({ examId, studentId: req.userId });

    if (!attempt) {
      attempt = await Answer.create({
        studentId: req.userId,
        examId,
        totalQuestions: exam.questions.length,
        timeRemaining: exam.duration * 60,
      });
    }

    if (attempt.status !== "in-progress") {
      return res.status(400).json({ error: "Exam already submitted." });
    }

    const normalisedAnswers = normalisePayloadAnswers(answers);

    const { evaluatedAnswers, correctAnswers, percentage } = evaluateSubmission(
      exam,
      normalisedAnswers,
      attempt.answers
    );

    attempt.answers = evaluatedAnswers;
    attempt.correctAnswers = correctAnswers;
    attempt.totalQuestions = exam.questions.length;
    attempt.percentage = percentage;
    attempt.lastSavedAt = new Date();
    if (typeof timeRemaining === "number" && timeRemaining >= 0) {
      attempt.timeRemaining = timeRemaining;
    }

    await attempt.save();

    res.json({
      message: "Progress saved",
      timeRemaining: attempt.timeRemaining,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save progress." });
  }
});

router.post("/submit", authMiddleware, async (req, res) => {
  try {
    const { examId, answers, timeRemaining, violationsCount } = req.body;

    if (!isValidObjectId(examId)) {
      return res.status(400).json({ error: "Invalid exam id." });
    }

    const exam = await Exam.findById(examId).lean();
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    const attempt = await Answer.findOne({ examId, studentId: req.userId });
    if (!attempt) {
      return res.status(404).json({ error: "No active attempt found." });
    }

    if (attempt.status !== "in-progress") {
      return res.status(400).json({ error: "Exam already submitted." });
    }

    const normalisedAnswers = normalisePayloadAnswers(answers);

    const { correctAnswers, percentage } = await finalizeSubmission({
      exam,
      attempt,
      answers: normalisedAnswers,
      timeRemaining,
      violationsCount,
      autoSubmitted: false,
    });

    const passed = percentage >= exam.passingPercentage;

    // Generate question breakdown for detailed results
    const questionBreakdown = exam.questions.map((question, index) => {
      const answer = normalisedAnswers.find(a => a.questionIndex === index);
      const selectedOption = answer?.selectedOption;
      const isCorrect = selectedOption === question.correctOptionIndex;
      
      return {
        question: question.prompt || question.question,
        yourAnswer: selectedOption !== null && selectedOption !== undefined 
          ? question.options[selectedOption] 
          : null,
        correctAnswer: question.options[question.correctOptionIndex],
        isCorrect,
        category: question.category
      };
    });

    res.json({
      message: "Exam submitted successfully",
      score: percentage,
      correctAnswers,
      totalQuestions: exam.questions.length,
      passed,
      questionBreakdown
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit exam." });
  }
});

module.exports = router;
