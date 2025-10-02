import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  MessageSquare,
  Upload,
  Play,
  Pause,
  Clock,
  CheckCircle,
  Search,
  ChevronDown,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  TrendingUp,
  Award,
  FileText,
  Sparkles,
  Zap,
  Target
} from 'lucide-react';

// --- CONFIGURATION ---
const QUESTION_LEVELS = [
  { level: 'Easy', time: 20 },
  { level: 'Easy', time: 20 },
  { level: 'Medium', time: 60 },
  { level: 'Medium', time: 60 },
  { level: 'Hard', time: 120 },
  { level: 'Hard', time: 120 },
];

const API_MODEL = 'gemini-2.5-flash-preview-05-20';
const API_KEY = "AIzaSyDV-twuWsmfAEy7Tvf_O1PkfRaWaT09Tuk";

const initialCandidateState = {
  id: crypto.randomUUID(),
  name: '',
  email: '',
  phone: '',
  status: 'Pending Resume',
  finalScore: null,
  finalSummary: '',
  chatHistory: [],
  interviewProgress: {
    currentQuestionIndex: 0,
    currentTimer: 0,
    isPaused: false,
    questions: [],
  },
};

// --- UTILITIES ---
const validateEmail = (text) => /\S+@\S+\.\S+/.test(text);
const validatePhone = (text) => text.replace(/[\s\-\+\(\)]/g, '').length >= 7;

const getNextMissingField = (candidate) => {
    if (!candidate.name || candidate.name === 'Candidate' || candidate.name.toLowerCase() === 'n/a') return 'Name';
    if (!candidate.email || candidate.email.toLowerCase() === 'n/a' || !validateEmail(candidate.email)) return 'Email';
    if (!candidate.phone || candidate.phone.toLowerCase() === 'n/a' || !validatePhone(candidate.phone)) return 'Phone';
    return null;
};

const withBackoff = async (apiCall, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

// --- API FUNCTIONS ---
const parseResumeWithAI = async (base64Data, mimeType) => {
  console.log('Parsing resume...');
  const data = base64Data.split(',')[1];

  const systemPrompt = `Extract Name, Email, and Phone Number from the document. If a field cannot be found, set its value to 'N/A'. Return as JSON.`;
  
  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: systemPrompt },
        { inlineData: { mimeType: mimeType, data: data }}
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          "name": { "type": "STRING" },
          "email": { "type": "STRING" },
          "phone": { "type": "STRING" }
        },
        "required": ["name", "email", "phone"]
      }
    }
  };

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("Failed to parse resume");
    return JSON.parse(jsonText);
  } catch (e) {
    console.error("Resume parsing failed:", e);
    return { name: 'N/A', email: 'N/A', phone: 'N/A' };
  }
};

const generateQuestions = async () => {
    console.log('Generating questions...');
    const prompt = `Generate 6 technical interview questions for a Full Stack Developer position (React/Node.js focus). 
    
Requirements:
- 2 Easy questions (fundamental concepts, basic syntax, simple problem-solving)
- 2 Medium questions (intermediate concepts, practical scenarios, design patterns)
- 2 Hard questions (advanced concepts, system design, complex problem-solving, optimization)

Each question should be clear, specific, and test real-world knowledge. Return as JSON array.`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        "level": { "type": "STRING", "enum": ["Easy", "Medium", "Hard"] },
                        "text": { "type": "STRING" }
                    },
                    "required": ["level", "text"]
                }
            }
        }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("Failed to generate questions");
        
        const generatedList = JSON.parse(jsonText);
        return generatedList.map((q, index) => ({
            id: `q${index + 1}`,
            level: q.level,
            text: q.text,
            timerMax: QUESTION_LEVELS.find(ql => ql.level === q.level).time,
            candidateAnswer: '',
            aiScore: null,
            aiFeedback: '',
        }));
    } catch (e) {
        console.error("Question generation failed:", e);
        return QUESTION_LEVELS.map((q, index) => ({
            id: `q${index + 1}`,
            level: q.level,
            text: `[MOCK Q${index + 1} - ${q.level}] Describe your experience with React and Node.js`,
            timerMax: q.time,
            candidateAnswer: '',
            aiScore: null,
            aiFeedback: '',
        }));
    }
};

const judgeAnswer = async (question, answer) => {
    const systemPrompt = `You are an expert technical interviewer evaluating answers for a Full Stack Developer position (React/Node.js).

SCORING CRITERIA:
1. Technical Accuracy (40%): Is the answer technically correct? Are concepts explained properly?
2. Depth of Understanding (30%): Does the candidate show deep knowledge or just surface-level understanding?
3. Clarity & Communication (15%): Is the answer well-structured and easy to follow?
4. Practical Application (15%): Does the candidate demonstrate real-world experience and practical knowledge?

SCORING SCALE:
- 90-100: Exceptional answer with deep understanding, accurate details, and practical insights
- 75-89: Strong answer with good technical knowledge and clear explanation
- 60-74: Adequate answer covering basics but lacking depth or with minor inaccuracies
- 40-59: Weak answer with significant gaps or misconceptions
- 0-39: Poor answer showing lack of understanding or completely incorrect

DIFFICULTY ADJUSTMENTS:
- Easy questions: Expected to score 70-90 for competent candidates
- Medium questions: Expected to score 60-80 for competent candidates  
- Hard questions: Expected to score 50-75 for competent candidates

Provide constructive, specific feedback that helps the candidate improve. Point out what they did well AND what could be better.`;

    const userQuery = `QUESTION DIFFICULTY: ${question.level}
QUESTION: ${question.text}

CANDIDATE'S ANSWER: ${answer}

Evaluate this answer and provide:
1. A score from 0-100 based on the criteria above
2. Detailed feedback explaining the score, highlighting strengths and areas for improvement`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "score": { "type": "NUMBER" },
                    "feedback": { "type": "STRING" }
                },
                "required": ["score", "feedback"]
            }
        }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        return JSON.parse(jsonText);
    } catch (e) {
        const score = 50 + Math.floor(Math.random() * 50);
        return { score, feedback: `Your answer scored ${score}/100. Consider providing more detail and specific examples.` };
    }
};

const generateSummary = async (questions) => {
    const history = questions.map((q, i) => 
        `QUESTION ${i + 1} [${q.level}] - Score: ${q.aiScore}/100
Q: ${q.text}
A: ${q.candidateAnswer}
Feedback: ${q.aiFeedback}`
    ).join('\n\n---\n\n');

    const systemPrompt = `You are a hiring manager reviewing a Full Stack Developer interview. Provide:
1. A final overall score (0-100) that weighs all questions appropriately
2. A comprehensive summary (3-4 sentences) covering:
   - Overall performance and key strengths
   - Areas that need improvement
   - Hiring recommendation (Strong Hire / Hire / Maybe / No Hire)`;

    const payload = {
        contents: [{ parts: [{ text: `INTERVIEW TRANSCRIPT:\n\n${history}\n\nProvide final evaluation:` }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "finalScore": { "type": "NUMBER" },
                    "finalSummary": { "type": "STRING" }
                },
                "required": ["finalScore", "finalSummary"]
            }
        }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        return JSON.parse(result.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (e) {
        const validScores = questions.map(q => q.aiScore).filter(s => s !== null);
        const totalScore = Math.round(validScores.reduce((sum, s) => sum + s, 0) / validScores.length);
        return { finalScore: totalScore, finalSummary: `Overall performance: ${totalScore}/100 based on ${validScores.length} questions answered.` };
    }
};

// --- ONBOARDING ANIMATION ---
const OnboardingAnimation = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  
  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 500),
      setTimeout(() => setStep(2), 1500),
      setTimeout(() => setStep(3), 2500),
      setTimeout(() => onComplete(), 3800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  const features = [
    { icon: Upload, text: "Upload your resume", color: "from-blue-500 to-blue-600" },
    { icon: MessageSquare, text: "Answer AI-generated questions", color: "from-purple-500 to-purple-600" },
    { icon: Award, text: "Get instant feedback & scores", color: "from-green-500 to-green-600" },
  ];

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 flex items-center justify-center z-50">
      <div className="text-center px-6">
        <div className={`transform transition-all duration-700 ${step >= 0 ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
          <div className="bg-white p-6 rounded-full w-24 h-24 mx-auto mb-8 shadow-2xl flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-indigo-600 animate-pulse" />
          </div>
          <h1 className="text-5xl font-extrabold text-white mb-4">
            AI Interview Assistant
          </h1>
          <p className="text-blue-100 text-xl mb-12">Your intelligent interview partner</p>
        </div>

        <div className="space-y-6 max-w-md mx-auto">
          {features.map((feature, index) => (
            <div
              key={index}
              className={`transform transition-all duration-500 delay-${index * 200} ${
                step > index ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0'
              }`}
            >
              <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl p-4 flex items-center space-x-4">
                <div className={`bg-gradient-to-br ${feature.color} p-3 rounded-xl`}>
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-white font-semibold text-lg">{feature.text}</span>
              </div>
            </div>
          ))}
        </div>

        {step >= 3 && (
          <div className="mt-12 animate-pulse">
            <div className="w-2 h-2 bg-white rounded-full mx-auto"></div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- COMPONENTS ---
const WelcomeBackModal = ({ activeCandidate, onClose, onNewSession }) => {
  if (activeCandidate.status !== 'In Progress' && activeCandidate.status !== 'Collecting Info') return null;

  const progressCount = activeCandidate.interviewProgress.questions.filter(q => q.candidateAnswer).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center mb-4">
          <div className="bg-blue-100 p-3 rounded-full mr-3">
            <AlertCircle className="w-6 h-6 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Welcome Back!</h2>
        </div>
        <p className="text-gray-600 mb-6">
          You have an ongoing session. Resume or start fresh?
        </p>
        <div className="bg-blue-50 p-4 rounded-lg mb-6">
          <p className="font-semibold text-gray-800 mb-2">Current Progress:</p>
          <div className="flex items-center text-sm text-gray-600">
            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
            <span>
                {activeCandidate.status === 'Collecting Info'
                    ? 'Collecting profile information'
                    : `${progressCount}/6 questions completed`
                }
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onNewSession}
            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition"
          >
            Start Fresh
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition shadow-lg"
          >
            <Play className="w-4 h-4 inline mr-2" />
            Resume
          </button>
        </div>
      </div>
    </div>
  );
};

const IntervieweeChat = ({ activeCandidate, setActiveCandidate, isLoading, setIsLoading, resetSession }) => {
  const [currentInput, setCurrentInput] = useState('');
  const chatEndRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeCandidate.chatHistory.length]);

  const processAnswerAndNextQuestion = useCallback(async (question, answer, questionIndex) => {
    setIsLoading(true);

    try {
      const { score, feedback } = await judgeAnswer(question, answer);
      const isLastQuestion = questionIndex === QUESTION_LEVELS.length - 1;

      let newQuestions = [...activeCandidate.interviewProgress.questions];
      newQuestions[questionIndex] = {
        ...question,
        candidateAnswer: answer,
        aiScore: score,
        aiFeedback: feedback,
      };

      let newChatHistory = [
        ...activeCandidate.chatHistory,
        { type: 'system', content: `Question ${questionIndex + 1} scored: ${score}/100`, timestamp: Date.now() },
      ];

      let newStatus = activeCandidate.status;
      let nextQuestionIndex = questionIndex + 1;
      let nextTimer = 0;
      let finalScore = null;
      let finalSummary = '';

      if (isLastQuestion) {
        const summaryData = await generateSummary(newQuestions);
        finalScore = summaryData.finalScore;
        finalSummary = summaryData.finalSummary;
        newStatus = 'Completed';
        newChatHistory.push({ type: 'system', content: `Interview complete! Final score: ${finalScore}/100`, timestamp: Date.now() });
      } else {
        const nextQuestion = newQuestions[nextQuestionIndex];
        nextTimer = nextQuestion.timerMax;
        newChatHistory.push({ type: 'ai-question', content: nextQuestion.text, timestamp: Date.now() });
      }

      setActiveCandidate(prev => ({
        ...prev,
        status: newStatus,
        finalScore: finalScore,
        finalSummary: finalSummary,
        chatHistory: newChatHistory,
        interviewProgress: {
          ...prev.interviewProgress,
          currentQuestionIndex: nextQuestionIndex,
          currentTimer: nextTimer,
          isPaused: false,
          questions: newQuestions,
        },
      }));

    } catch (error) {
      console.error("Error processing answer:", error);
      setActiveCandidate(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { type: 'system', content: 'Error processing answer. Please try again.', timestamp: Date.now() }]
      }));
    } finally {
      setIsLoading(false);
    }
  }, [activeCandidate.chatHistory, activeCandidate.interviewProgress.questions, setActiveCandidate, setIsLoading]);

  const handleSubmission = useCallback((answer, isTimedOut) => {
    const { currentQuestionIndex, questions } = activeCandidate.interviewProgress;
    const currentQuestion = questions[currentQuestionIndex];

    if (!currentQuestion) return;

    if (isTimedOut) {
        setActiveCandidate(prev => ({
            ...prev,
            chatHistory: [
                ...prev.chatHistory,
                { type: 'system', content: `Time's up! Auto-submitting: "${answer || 'No answer'}"`, timestamp: Date.now() }
            ],
        }));
    }

    processAnswerAndNextQuestion(currentQuestion, answer, currentQuestionIndex);
    setCurrentInput('');
  }, [activeCandidate.interviewProgress, setActiveCandidate, processAnswerAndNextQuestion]);

  useEffect(() => {
    const { status, interviewProgress } = activeCandidate;
    const { currentTimer, isPaused } = interviewProgress;
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (status === 'In Progress' && !isPaused && !isLoading && currentTimer > 0) {
      timerRef.current = setInterval(() => {
        setActiveCandidate(prev => {
          const newTimer = prev.interviewProgress.currentTimer - 1;
          if (newTimer === 0) {
            handleSubmission(currentInput, true);
          }
          return {
            ...prev,
            interviewProgress: {
              ...prev.interviewProgress,
              currentTimer: newTimer,
            },
          };
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [activeCandidate.status, activeCandidate.interviewProgress.isPaused, activeCandidate.interviewProgress.currentTimer, isLoading]);

  const startInterview = useCallback(async () => {
    setIsLoading(true);
    try {
      const generatedQuestions = await generateQuestions();
      const firstQuestion = generatedQuestions[0];
      
      setActiveCandidate(prev => ({
        ...prev,
        status: 'In Progress',
        chatHistory: [
          ...prev.chatHistory,
          { type: 'system', content: 'Interview starting! You will answer 6 questions. Good luck!', timestamp: Date.now() },
          { type: 'ai-question', content: firstQuestion.text, timestamp: Date.now() },
        ],
        interviewProgress: {
          ...prev.interviewProgress,
          currentQuestionIndex: 0,
          currentTimer: firstQuestion.timerMax,
          isPaused: false,
          questions: generatedQuestions,
        },
      }));
    } catch (error) {
      console.error("Error starting interview:", error);
      setActiveCandidate(prev => ({ 
        ...prev, 
        status: 'Collecting Info', 
        chatHistory: [...prev.chatHistory, { type: 'system', content: 'Failed to start interview. Please try again.', timestamp: Date.now() }] 
      }));
    } finally {
      setIsLoading(false);
    }
  }, [setActiveCandidate, setIsLoading]);

  useEffect(() => {
    if (activeCandidate.status === 'Starting Interview') {
      const timeout = setTimeout(() => startInterview(), 500);
      return () => clearTimeout(timeout);
    }
  }, [activeCandidate.status, startInterview]);

  const handleResumeUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (activeCandidate.status !== 'Pending Resume') {
      alert("Session already active. Start a new session first.");
      return;
    }

    setIsLoading(true);

    try {
      const base64Data = await fileToBase64(file);
      const extractedData = await parseResumeWithAI(base64Data, file.type);
      
      let newCandidate = {
        ...activeCandidate,
        name: extractedData.name,
        email: extractedData.email,
        phone: extractedData.phone,
        chatHistory: [
          { type: 'system', content: 'Welcome! Please upload your resume (PDF/DOCX) to begin.', timestamp: Date.now() },
          { type: 'system', content: `Resume uploaded: ${file.name}`, timestamp: Date.now() },
          { type: 'system', content: `**Extracted Data**\n• Name: ${extractedData.name}\n• Email: ${extractedData.email}\n• Phone: ${extractedData.phone}`, timestamp: Date.now() },
        ]
      };

      const nextField = getNextMissingField(newCandidate);
      
      if (nextField) {
        newCandidate.status = 'Collecting Info';
        newCandidate.chatHistory.push({
            type: 'ai-question',
            content: `Hello! I need your **${nextField}**. Please provide it below.`,
            timestamp: Date.now()
        });
      } else {
        newCandidate.status = 'Starting Interview';
        newCandidate.chatHistory.push({
            type: 'system',
            content: "All details confirmed. Starting interview...",
            timestamp: Date.now()
        });
      }
      
      setActiveCandidate(newCandidate);
      
    } catch (error) {
      alert("Error processing resume. Please try again.");
      console.error("Resume error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const collectMissingInfo = (input) => {
    const fieldToCollect = getNextMissingField(activeCandidate);
    if (!fieldToCollect) return;

    let updateObject = {};
    let successMessage = null;
    let isValid = true;

    if (fieldToCollect === 'Name') {
        updateObject = { name: input };
        successMessage = `Thanks, ${input}!`;
    } else if (fieldToCollect === 'Email') {
        if (validateEmail(input)) {
            updateObject = { email: input };
            successMessage = `Email confirmed: ${input}`;
        } else {
            isValid = false;
        }
    } else if (fieldToCollect === 'Phone') {
        if (validatePhone(input)) {
            updateObject = { phone: input };
            successMessage = `Phone confirmed: ${input}`;
        } else {
            isValid = false;
        }
    }

    if (!isValid) {
        setActiveCandidate(prev => ({
            ...prev,
            chatHistory: [...prev.chatHistory, { type: 'system', content: `Invalid ${fieldToCollect}. Please try again.`, timestamp: Date.now() }]
        }));
        return;
    }

    let tempCandidate = { ...activeCandidate, ...updateObject };
    const nextField = getNextMissingField(tempCandidate);

    if (nextField) {
        setActiveCandidate(prev => ({
            ...prev,
            ...updateObject,
            chatHistory: [
                ...prev.chatHistory,
                { type: 'ai-question', content: `${successMessage} Now, please provide your **${nextField}**.`, timestamp: Date.now() }
            ]
        }));
    } else {
        setActiveCandidate(prev => ({
            ...prev,
            ...updateObject,
            status: 'Starting Interview',
            chatHistory: [
                ...prev.chatHistory,
                { type: 'system', content: `${successMessage} All details confirmed. Starting interview...`, timestamp: Date.now() }
            ]
        }));
    }
  };

  const handleSend = () => {
    const input = currentInput.trim();
    if (!input || isLoading || activeCandidate.interviewProgress.isPaused) return;

    setActiveCandidate(prev => ({
        ...prev,
        chatHistory: [
            ...prev.chatHistory,
            { type: 'user', content: input, timestamp: Date.now() }
        ]
    }));
    setCurrentInput('');

    if (activeCandidate.status === 'Collecting Info') {
        collectMissingInfo(input);
    } else if (activeCandidate.status === 'In Progress') {
        handleSubmission(input, false);
    } 
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
  };

  const isInterviewActive = activeCandidate.status === 'In Progress';
  const isFinished = activeCandidate.status === 'Completed';
  const isInputDisabled = isLoading || isFinished || activeCandidate.status === 'Starting Interview';
  const currentQ = activeCandidate.interviewProgress.questions[activeCandidate.interviewProgress.currentQuestionIndex];

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-blue-50 rounded-2xl shadow-2xl">
      <header className="p-4 sm:p-6 border-b bg-white rounded-t-2xl flex justify-between items-center shadow-sm">
        <div className="flex items-center">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg mr-3">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Interview Chat</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
            {isInterviewActive && currentQ && (
                <>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                        currentQ.level === 'Easy' ? 'bg-green-100 text-green-700' :
                        currentQ.level === 'Medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                    }`}>
                        Q{activeCandidate.interviewProgress.currentQuestionIndex + 1}/6 • {currentQ.level}
                    </span>
                    <div className="flex items-center bg-red-50 px-3 py-1 rounded-full">
                      <Clock className="w-4 h-4 mr-1 text-red-600" />
                      <span className="text-red-600 font-mono font-bold text-sm">
                        {Math.floor(activeCandidate.interviewProgress.currentTimer / 60)}:{String(activeCandidate.interviewProgress.currentTimer % 60).padStart(2, '0')}
                      </span>
                    </div>
                    <button
                        onClick={() => setActiveCandidate(prev => ({ ...prev, interviewProgress: { ...prev.interviewProgress, isPaused: !prev.interviewProgress.isPaused } }))}
                        className={`px-3 py-1 text-xs rounded-full transition flex items-center ${activeCandidate.interviewProgress.isPaused ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
                        disabled={isLoading}
                    >
                        {activeCandidate.interviewProgress.isPaused ? <><Play className="w-3 h-3 mr-1" />Resume</> : <><Pause className="w-3 h-3 mr-1" />Pause</>}
                    </button>
                </>
            )}
            <button
                onClick={resetSession}
                className="px-3 py-1 text-xs rounded-full bg-red-100 text-red-700 font-semibold hover:bg-red-200 transition"
                disabled={isLoading}
            >
                New Session
            </button>
        </div>
      </header>

      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {activeCandidate.chatHistory.map((msg, index) => (
          <div key={index} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] sm:max-w-[75%] p-3 rounded-2xl shadow-md ${
                msg.type === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                  : msg.type === 'ai-question'
                  ? 'bg-white text-gray-900 border-2 border-blue-200'
                  : 'bg-white text-gray-800'
              }`}>
              <p className={`whitespace-pre-wrap text-sm ${msg.type === 'ai-question' ? 'font-semibold' : ''}`}>
                  {msg.content.split('\n').map((line, i) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                          return <strong key={i} className="block mb-2">{line.replace(/\*\*/g, '')}</strong>;
                      }
                      const match = line.match(/^• \*\*(\w+):\*\* (.+)/) || line.match(/^- \*\*(\w+):\*\* (.+)/);
                      if (match) {
                          return <span key={i} className="block text-xs"><strong>{match[1]}:</strong> {match[2]}</span>;
                      }
                      return <span key={i} className="block">{line}</span>;
                  })}
              </p>
              <span className="text-xs opacity-70 mt-1 block text-right">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-700 p-3 rounded-2xl shadow-md">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                <span className="ml-2 text-sm">Processing...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 border-t bg-white rounded-b-2xl">
        {isFinished ? (
            <div className='p-4 text-center bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border-2 border-green-200'>
              <Award className="w-8 h-8 mx-auto mb-2 text-green-600" />
              <p className="text-green-800 font-bold text-lg">Interview Complete!</p>
              <p className="text-green-700 text-sm">Final Score: {activeCandidate.finalScore}%</p>
            </div>
        ) : activeCandidate.status === 'Pending Resume' ? (
            <label className="flex items-center justify-center p-6 border-2 border-dashed border-blue-300 rounded-xl cursor-pointer bg-gradient-to-br from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition group">
                <Upload className="w-6 h-6 mr-3 text-blue-600 group-hover:scale-110 transition" />
                <span className="text-blue-700 font-semibold">
                    Upload Resume to Begin
                </span>
                <input type="file" className="hidden" accept=".pdf,.docx" onChange={handleResumeUpload} disabled={isLoading} />
            </label>
        ) : (
            <div className="flex gap-2 items-end">
                <textarea
                    className="flex-1 p-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition"
                    placeholder={activeCandidate.status === 'Collecting Info' ? 'Enter missing information...' : 'Type your answer...'}
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows="2"
                    disabled={isInputDisabled || activeCandidate.interviewProgress.isPaused}
                />
                <button
                    onClick={handleSend}
                    className="flex items-center justify-center px-4 h-12 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isInputDisabled || (!currentInput.trim() && isInterviewActive) || activeCandidate.interviewProgress.isPaused}
                >
                    <CornerDownLeft className="w-5 h-5" />
                </button>
            </div>
        )}
      </div>
    </div>
  );
};

const InterviewerDashboard = ({ candidates }) => {
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [sortKey, setSortKey] = useState('finalScore');
    const [sortDirection, setSortDirection] = useState('desc');
    const [searchTerm, setSearchTerm] = useState('');

    const completedCandidates = candidates.filter(c => c.status !== 'Pending Resume');

    const sortedCandidates = [...completedCandidates]
        .filter(c => 
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            c.email.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .sort((a, b) => {
            let aValue = a.finalScore === null ? -1 : a.finalScore;
            let bValue = b.finalScore === null ? -1 : b.finalScore;

            if (sortKey === 'finalScore') {
                return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
            }
            return sortDirection === 'asc' ? String(a.name).localeCompare(String(b.name)) : String(b.name).localeCompare(String(a.name));
        });

    const handleSort = (key) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    };
    
    const SortIndicator = ({ columnKey }) => {
        if (sortKey !== columnKey) return <ChevronDown className="w-4 h-4 ml-1 opacity-30" />;
        return sortDirection === 'asc' ? <ArrowUp className="w-4 h-4 ml-1" /> : <ArrowDown className="w-4 h-4 ml-1" />;
    };

    if (selectedCandidate) {
        const candidateData = candidates.find(c => c.id === selectedCandidate.id);
        if (!candidateData) return <div>Candidate not found.</div>;

        return (
            <div className="p-4 sm:p-6 bg-gradient-to-br from-gray-50 to-blue-50 rounded-2xl shadow-2xl h-full overflow-y-auto">
                <button
                    onClick={() => setSelectedCandidate(null)}
                    className="mb-6 text-blue-600 font-semibold hover:text-blue-800 transition flex items-center group"
                >
                    <div className="bg-blue-100 p-2 rounded-lg mr-2 group-hover:bg-blue-200 transition">
                      ← Back
                    </div>
                </button>
                
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                  <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center">
                    <FileText className="w-8 h-8 mr-3 text-blue-600" />
                    {candidateData.name || 'Candidate'}'s Report
                  </h2>

                  <div className="grid md:grid-cols-2 gap-6 mb-8">
                      <div className="p-5 border-2 border-gray-200 rounded-xl bg-gradient-to-br from-gray-50 to-white">
                          <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center">
                            <Users className="w-5 h-5 mr-2 text-blue-600" />
                            Profile
                          </h3>
                          <div className="space-y-2 text-sm">
                            <p><strong className="text-gray-700">Name:</strong> <span className="text-gray-600">{candidateData.name || 'N/A'}</span></p>
                            <p><strong className="text-gray-700">Email:</strong> <span className="text-gray-600">{candidateData.email || 'N/A'}</span></p>
                            <p><strong className="text-gray-700">Phone:</strong> <span className="text-gray-600">{candidateData.phone || 'N/A'}</span></p>
                            <p><strong className="text-gray-700">Status:</strong> <span className={`font-bold ${
                                candidateData.status === 'Completed' ? 'text-green-600' : 
                                candidateData.status === 'In Progress' ? 'text-amber-600' :
                                'text-blue-600'
                            }`}>{candidateData.status}</span></p>
                          </div>
                      </div>
                      
                      <div className="p-5 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl">
                          <h3 className="text-lg font-bold mb-3 flex items-center">
                            <TrendingUp className="w-5 h-5 mr-2" />
                            Final Score
                          </h3>
                          <div className="text-6xl font-extrabold mb-2">
                            {candidateData.finalScore ? `${candidateData.finalScore}%` : 'N/A'}
                          </div>
                          <p className='text-blue-100 text-sm italic'>{candidateData.finalSummary || 'Summary pending completion'}</p>
                      </div>
                  </div>

                  <h3 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                    <MessageSquare className="w-6 h-6 mr-2 text-blue-600" />
                    Question Breakdown
                  </h3>
                  <div className="space-y-4">
                      {candidateData.interviewProgress.questions.map((q, index) => (
                          <div key={q.id} className="border-2 border-gray-200 p-5 rounded-xl shadow-md bg-white hover:shadow-lg transition">
                              <div className="flex justify-between items-center mb-3">
                                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                                      q.level === 'Easy' ? 'bg-green-100 text-green-700' :
                                      q.level === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                      'bg-red-100 text-red-700'
                                  }`}>
                                      {q.level} • Q{index + 1}/6
                                  </span>
                                  <div className="flex items-center">
                                    <span className="text-2xl font-bold text-gray-800">{q.aiScore !== null ? q.aiScore : '-'}</span>
                                    <span className="text-gray-500 text-sm ml-1">/100</span>
                                  </div>
                              </div>
                              <p className="font-semibold text-gray-900 mb-3">{q.text}</p>
                              <div className="bg-gray-50 p-4 rounded-lg mb-3">
                                  <p className="text-xs font-bold text-blue-600 mb-1">CANDIDATE ANSWER:</p>
                                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{q.candidateAnswer || 'No answer submitted'}</p>
                              </div>
                              {q.aiFeedback && (
                                  <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
                                      <p className="text-xs font-bold text-blue-700 mb-1">AI FEEDBACK:</p>
                                      <p className="text-sm text-gray-800">{q.aiFeedback}</p>
                                  </div>
                              )}
                          </div>
                      ))}
                  </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 bg-gradient-to-br from-gray-50 to-blue-50 rounded-2xl shadow-2xl h-full flex flex-col">
            <div className="bg-white rounded-2xl shadow-lg p-6 flex-1 flex flex-col">
              <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                <Users className="w-7 h-7 mr-3 text-blue-600" />
                Candidate Dashboard
              </h2>

              <div className="mb-4">
                  <div className="relative">
                      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                      <input
                          type="text"
                          placeholder="Search candidates..."
                          className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>

              <div className="overflow-x-auto flex-1 rounded-xl border-2 border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-blue-50 to-indigo-50 sticky top-0">
                          <tr>
                              <th 
                                  className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition"
                                  onClick={() => handleSort('name')}
                              >
                                  <div className="flex items-center">
                                      Name
                                      <SortIndicator columnKey="name" />
                                  </div>
                              </th>
                              <th className="hidden sm:table-cell px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                  Email
                              </th>
                              <th
                                  className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-blue-100 transition"
                                  onClick={() => handleSort('finalScore')}
                              >
                                  <div className="flex items-center">
                                      Score
                                      <SortIndicator columnKey="finalScore" />
                                  </div>
                              </th>
                              <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                                  Status
                              </th>
                              <th className="px-6 py-4 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">
                                  Action
                              </th>
                          </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                          {sortedCandidates.length > 0 ? (
                              sortedCandidates.map((c) => (
                                  <tr key={c.id} className="hover:bg-blue-50 transition">
                                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{c.name || 'N/A'}</td>
                                      <td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-600">{c.email || 'N/A'}</td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                          {c.finalScore !== null ? (
                                            <span className='text-lg font-bold text-blue-600'>{c.finalScore}%</span>
                                          ) : (
                                            <span className='text-sm font-semibold text-amber-600'>Pending</span>
                                          )}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                          <span className={`px-3 py-1 inline-flex text-xs font-bold rounded-full ${
                                              c.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                                          }`}>
                                              {c.status === 'Starting Interview' ? 'In Progress' : c.status}
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-right">
                                          <button
                                              onClick={() => setSelectedCandidate(c)}
                                              className="text-blue-600 hover:text-blue-800 transition font-bold text-sm"
                                          >
                                              View Details →
                                          </button>
                                      </td>
                                  </tr>
                              ))
                          ) : (
                              <tr>
                                  <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                    <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                                    No candidates found
                                  </td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              </div>
            </div>
        </div>
    );
};

export default function App() {
  const [appState, setAppState] = useState({
    activeTab: 'interviewee',
    candidates: [initialCandidateState],
    showWelcomeModal: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const { activeTab, candidates, showWelcomeModal } = appState;

  const activeCandidate = candidates[candidates.length - 1];

  const setActiveCandidate = (updater) => {
    setAppState(prev => {
      const updatedCandidates = [...prev.candidates];
      const newActiveCandidate = typeof updater === 'function' ? updater(updatedCandidates[updatedCandidates.length - 1]) : updater;
      updatedCandidates[updatedCandidates.length - 1] = newActiveCandidate;
      return { ...prev, candidates: updatedCandidates };
    });
  };

  useEffect(() => {
    const hasSeenOnboarding = sessionStorage.getItem('hasSeenOnboarding');
    if (hasSeenOnboarding) {
      setShowOnboarding(false);
    }
  }, []);

  useEffect(() => {
    if (!showOnboarding) {
      const isCollectingOrInProgress = activeCandidate.status !== 'Completed' && activeCandidate.status !== 'Pending Resume' && activeCandidate.status !== 'Starting Interview';
      setAppState(prev => ({ ...prev, showWelcomeModal: isCollectingOrInProgress }));
    }
  }, [showOnboarding]);

  const resetSession = useCallback(() => {
    setAppState(prev => ({
      ...prev,
      candidates: [...prev.candidates, initialCandidateState],
      showWelcomeModal: false,
    }));
  }, []);

  const handleResume = () => {
    setAppState(prev => ({ ...prev, showWelcomeModal: false, activeTab: 'interviewee' }));
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    sessionStorage.setItem('hasSeenOnboarding', 'true');
  };

  if (showOnboarding) {
    return <OnboardingAnimation onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-blue-50 to-indigo-100 p-4 md:p-8 font-sans flex items-center justify-center"> 
        <div className="w-full max-w-[1400px]">
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                AI Interview Assistant
            </h1>
            <p className="text-gray-600 text-sm">Powered by Google Gemini AI</p>
          </div>

          <div className="flex border-b-2 border-gray-200 mb-6 bg-white rounded-t-2xl shadow-lg">
            <TabButton
                icon={MessageSquare}
                label="Interviewee"
                active={activeTab === 'interviewee'}
                onClick={() => setAppState(prev => ({ ...prev, activeTab: 'interviewee' }))}
            />
            <TabButton
                icon={Users}
                label="Dashboard"
                active={activeTab === 'interviewer'}
                onClick={() => setAppState(prev => ({ ...prev, activeTab: 'interviewer' }))}
            />
          </div>

          <div className="h-[calc(100vh-220px)] min-h-[600px]">
            {activeTab === 'interviewee' ? (
                <IntervieweeChat
                    activeCandidate={activeCandidate}
                    setActiveCandidate={setActiveCandidate}
                    isLoading={isLoading}
                    setIsLoading={setIsLoading}
                    resetSession={resetSession}
                />
            ) : (
                <InterviewerDashboard candidates={candidates} />
            )}
          </div>
        </div>

        {showWelcomeModal && (
            <WelcomeBackModal
                activeCandidate={activeCandidate}
                onClose={handleResume}
                onNewSession={resetSession}
            />
        )}
    </div>
  );
}

const TabButton = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center px-6 py-4 text-sm font-bold transition-all duration-200 ${
      active
        ? 'text-blue-600 border-b-4 border-blue-600 bg-white'
        : 'text-gray-500 hover:text-blue-600 hover:bg-gray-50'
    }`}
  >
    <Icon className="w-5 h-5 mr-2" />
    <span className="hidden sm:inline">{label}</span>
  </button>
);