#!/usr/bin/env node
/**
 * CSV Quiz Import Script for SEB-Lite
 * Imports questions from DATASET_CSV.csv into MongoDB
 * Groups questions by topic/category and creates separate exams
 */

const fs = require('fs');
const path = require('path');

// Use modules from backend's node_modules
const backendModules = path.join(__dirname, '../backend/node_modules');
const mongoose = require(path.join(backendModules, 'mongoose'));
const dotenv = require(path.join(backendModules, 'dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/seb_lite';

// Import Exam model
const Exam = require('../backend/models/Exam');
const User = require('../backend/models/User');

// CSV file path
const CSV_FILE = path.join(__dirname, '../examples/DATASET_CSV.csv');

// Parse CSV manually (no external dependencies needed)
function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    if (values.length >= 7) {
      const record = {};
      headers.forEach((header, index) => {
        record[header.trim()] = values[index] ? values[index].trim() : '';
      });
      records.push(record);
    }
  }

  return records;
}

// Parse a single CSV line handling quoted values
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result.map(val => val.replace(/^"|"$/g, '').trim());
}

// Convert answer letter to index (A=0, B=1, C=2, D=3)
function answerToIndex(answer) {
  const map = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
  return map[answer.toUpperCase()] ?? 0;
}

// Calculate exam duration based on question count (1.5 min per question, min 10, max 120)
function calculateDuration(questionCount) {
  const duration = Math.ceil(questionCount * 1.5);
  return Math.max(10, Math.min(120, duration));
}

// Determine difficulty based on topic
function getDifficulty(topic) {
  const hardTopics = ['Advanced data structures', 'DAA', 'TOC', 'Compiler Design', 'Dynamic Programming'];
  const mediumTopics = ['Data structures', 'DBMS', 'Machine Learning', 'Data Warehouse and Data Mining', 'Cloud Computing'];
  
  if (hardTopics.includes(topic)) return 'Hard';
  if (mediumTopics.includes(topic)) return 'Medium';
  return 'Easy';
}

async function importQuizzes() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     📚 SEB-LITE CSV QUIZ IMPORT SCRIPT                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Connect to MongoDB
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Read CSV file
    console.log('📖 Reading CSV file...');
    if (!fs.existsSync(CSV_FILE)) {
      throw new Error(`CSV file not found: ${CSV_FILE}`);
    }

    const content = fs.readFileSync(CSV_FILE, 'utf-8');
    const records = parseCSV(content);
    console.log(`✅ Parsed ${records.length} records from CSV\n`);

    // Group questions by topic
    const questionsByTopic = {};
    let skippedCount = 0;

    for (const record of records) {
      const topic = record['TOPICS'];
      if (!topic || topic.trim() === '') {
        skippedCount++;
        continue;
      }

      const question = record['Question'];
      const optionA = record['Option A'];
      const optionB = record['Option B'];
      const optionC = record['Option C'];
      const optionD = record['Option D'];
      const correctAnswer = record['Correct Answer'];

      // Validate required fields
      if (!question || !optionA || !optionB || !optionC || !optionD || !correctAnswer) {
        skippedCount++;
        continue;
      }

      if (!questionsByTopic[topic]) {
        questionsByTopic[topic] = [];
      }

      // Clean question number from the prompt (e.g., "1. What is..." -> "What is...")
      const cleanPrompt = question.replace(/^\d+\.\s*/, '');

      questionsByTopic[topic].push({
        prompt: cleanPrompt,
        options: [optionA, optionB, optionC, optionD],
        correctOptionIndex: answerToIndex(correctAnswer),
        category: topic,
        difficulty: getDifficulty(topic),
        explanation: ''
      });
    }

    console.log(`📊 Found ${Object.keys(questionsByTopic).length} unique topics`);
    console.log(`⚠️  Skipped ${skippedCount} empty/invalid records\n`);

    // Find or create a default instructor
    let instructor = await User.findOne({ role: { $in: ['instructor', 'admin'] } });
    if (!instructor) {
      console.log('⚠️  No instructor found, creating default admin...');
      instructor = await User.create({
        name: 'Quiz Admin',
        email: 'admin@seblite.com',
        password: 'admin123',
        role: 'admin'
      });
      console.log('✅ Created default admin: admin@seblite.com / admin123\n');
    }

    // Create exams for each topic
    let createdCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    console.log('📝 Creating exams for each topic...\n');

    for (const [topic, questions] of Object.entries(questionsByTopic)) {
      try {
        const examTitle = `${topic} Quiz`;
        const duration = calculateDuration(questions.length);
        const difficulty = getDifficulty(topic);

        // Check if exam already exists
        const existingExam = await Exam.findOne({ title: examTitle });

        const examData = {
          title: examTitle,
          company: 'SEB-Lite',
          type: 'PLACEMENT_QUIZ',
          description: `Comprehensive ${topic} assessment with ${questions.length} questions. Imported from dataset.`,
          duration: duration,
          maxViolations: 3,
          passingPercentage: 40,
          instructions: [
            `This exam contains ${questions.length} questions on ${topic}.`,
            `Time limit: ${duration} minutes.`,
            'Do not switch tabs or windows during the exam.',
            'Do not use keyboard shortcuts (Alt+Tab, Ctrl+C, etc.).',
            'The exam will auto-submit if you exceed the violation limit.',
            'Each question carries 1 mark. No negative marking.',
            'You can navigate between questions using the question palette.'
          ],
          isActive: true,
          questions: questions,
          instructor: instructor._id,
          sourceUrl: 'DATASET_CSV.csv'
        };

        if (existingExam) {
          await Exam.findByIdAndUpdate(existingExam._id, examData);
          console.log(`   🔄 Updated: ${examTitle} (${questions.length} questions)`);
          updatedCount++;
        } else {
          await Exam.create(examData);
          console.log(`   ✅ Created: ${examTitle} (${questions.length} questions)`);
          createdCount++;
        }
      } catch (err) {
        console.log(`   ❌ Error with ${topic}: ${err.message}`);
        errorCount++;
      }
    }

    // Print summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    📊 IMPORT SUMMARY                       ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Total Records Parsed:    ${records.length.toString().padStart(6)}                          ║`);
    console.log(`║  Records Skipped:         ${skippedCount.toString().padStart(6)}                          ║`);
    console.log(`║  Topics Found:            ${Object.keys(questionsByTopic).length.toString().padStart(6)}                          ║`);
    console.log(`║  Exams Created:           ${createdCount.toString().padStart(6)}                          ║`);
    console.log(`║  Exams Updated:           ${updatedCount.toString().padStart(6)}                          ║`);
    console.log(`║  Errors:                  ${errorCount.toString().padStart(6)}                          ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // List all exams
    console.log('📋 All Quizzes in Database:\n');
    const allExams = await Exam.find({}).select('title questions duration isActive').lean();
    allExams.forEach((exam, i) => {
      const status = exam.isActive ? '✅ Active' : '❌ Inactive';
      console.log(`   ${i + 1}. ${exam.title} - ${exam.questions.length} questions, ${exam.duration} min [${status}]`);
    });

    console.log('\n✅ Import completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

// Run the import
importQuizzes();
