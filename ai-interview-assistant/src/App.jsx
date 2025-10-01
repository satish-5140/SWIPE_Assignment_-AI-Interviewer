import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  MessageSquare,
  Upload,
  Play,
  Pause,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  ChevronDown,
  CornerDownLeft,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

// --- CONSTANTS AND CONFIGURATION ---

const LOCAL_STORAGE_KEY = 'ai_interview_assistant_state';
const QUESTION_LEVELS = [
  { level: 'Easy', time: 20 },
  { level: 'Easy', time: 20 },
  { level: 'Medium', time: 60 },
  { level: 'Medium', time: 60 },
  { level: 'Hard', time: 120 },
  { level: 'Hard', time: 120 },
];

const initialCandidateState = {
  id: crypto.randomUUID(),
  name: '',
  email: '',
  phone: '',
  status: 'Pending Resume', // 'Pending Resume', 'Collecting Info', 'In Progress', 'Completed'
  finalScore: null, // Total score out of 100
  finalSummary: '',
  chatHistory: [
    { type: 'system', content: 'Welcome! Please upload your resume (PDF/DOCX) to begin.', timestamp: Date.now() },
  ],
  interviewProgress: {
    currentQuestionIndex: 0,
    currentTimer: 0, // seconds remaining
    isPaused: false,
    questions: [], // Populated when interview starts
  },
};

// --- UTILITY FUNCTIONS ---

const validateEmail = (text) => /\S+@\S+\.\S+/.test(text);
const validatePhone = (text) => text.replace(/[\s\-\+\(\)]/g, '').length >= 7; // Basic 7-digit check, allowing common separators

/**
 * Determines the next required field that is missing from the candidate's profile.
 * @param {object} candidate - The candidate object
 * @returns {('Name'|'Email'|'Phone'|null)} The name of the missing field or null if all are present.
 */
const getNextMissingField = (candidate) => {
    // Note: We treat an empty string or 'N/A' (from mock parser) as missing
    if (!candidate.name || candidate.name === 'Candidate' || candidate.name.toLowerCase() === 'n/a') return 'Name';
    if (!candidate.email || candidate.email.toLowerCase() === 'n/a' || !validateEmail(candidate.email)) return 'Email';
    if (!candidate.phone || candidate.phone.toLowerCase() === 'n/a' || !validatePhone(candidate.phone)) return 'Phone';
    return null;
};

/**
 * Executes an async function with exponential backoff retry logic.
 */
const withBackoff = async (apiCall, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Re-throw on final attempt
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // 1s, 2s, 4s + jitter
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};


// --- GEMINI API INTEGRATION (Actual Implementation for the Assignment) ---

const API_MODEL = 'gemini-2.5-flash-preview-05-20';
const API_KEY = "AIzaSyDV-twuWsmfAEy7Tvf_O1PkfRaWaT09Tuk"; 

/**
 * Converts a File object to a Base64 string.
 * @param {File} file 
 * @returns {Promise<string>} Base64 data string (e.g., "data:application/pdf;base64,...")
 */
const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

/**
 * Uses Gemini API (Multimodal) to parse a resume (Base64 encoded PDF/DOCX content)
 * and extract the required profile fields (Name, Email, Phone).
 * NOTE: Base64 data must be sent as inlineData part.
 */
const parseResumeWithAI = async (base64Data, mimeType) => {
  console.log('Parsing resume using Gemini API...');
  
  // Extract only the Base64 payload part (after the comma)
  const data = base64Data.split(',')[1];

  const systemPrompt = `You are a resume parser. Extract the full Name, Email, and Phone Number from the uploaded document. If a field cannot be found, set its value to 'N/A'. Return the results strictly as a JSON object matching the schema.`;
  
  const payload = {
    contents: [
        {
            role: "user",
            parts: [
                { text: systemPrompt },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: data
                    }
                }
            ]
        }
    ],
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

  const apiCall = async () => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await response.json();
    const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) throw new Error("AI failed to return structured resume data.");
    
    console.log('Resume Parsing: SUCCESS');
    return JSON.parse(jsonText);
  };

  // Fallback to mock data if API fails or is not supported
  try {
      return await withBackoff(apiCall);
  } catch (e) {
      console.error("AI Resume Parsing FAILED. Falling back to default 'N/A' values.", e);
      // Fallback implementation, which will force 'Collecting Info' flow if needed
      return {
        name: 'N/A', 
        email: 'N/A', 
        phone: 'N/A',
      };
  }
};


/**
 * Uses Gemini API to generate 6 interview questions (2 Easy, 2 Medium, 2 Hard).
 * Returns the structured question array.
 */
const generateQuestions = async () => {
    console.log('Generating questions using Gemini API...');
    const prompt = `Generate 6 interview questions for a Full Stack (React/Node) role. Follow this structure exactly: 2 Easy, 2 Medium, and 2 Hard questions. Return the response as a JSON array matching the provided schema.`;

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

    const apiCall = async () => {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("AI failed to return structured question data.");
        
        const generatedList = JSON.parse(jsonText);

        // Map the generated questions to the internal state structure
        const questions = generatedList.map((q, index) => ({
            id: `q${index + 1}`,
            level: q.level,
            text: q.text,
            timerMax: QUESTION_LEVELS.find(ql => ql.level === q.level).time,
            candidateAnswer: '',
            aiScore: null,
            aiFeedback: '',
        }));

        // Simple validation to ensure 6 questions are returned
        if (questions.length !== 6) throw new Error("AI did not return exactly 6 questions.");
        
        console.log('Question Generation: SUCCESS');
        return questions;
    };
    
    // Fallback to mock data if API fails or is not supported
    try {
        return await withBackoff(apiCall);
    } catch (e) {
        console.error("AI Question Generation FAILED. Using mock data.", e);
        // Note: mockGenerateQuestions is defined in the fallback to avoid hoisting issues
        const mockGenerateQuestions = async () => {
          const questions = QUESTION_LEVELS.map((q, index) => ({
            id: `q${index + 1}`,
            level: q.level,
            text: `[MOCK AI Q${index + 1} - ${q.level}] Describe a complex challenge you faced in a React/Node full-stack project and how you solved it. (MOCK DATA - FALLBACK ACTIVE)`,
            timerMax: q.time,
            candidateAnswer: '',
            aiScore: null,
            aiFeedback: '',
          }));
          questions[0].text = "[MOCK Q1 - Easy] Can you explain the concept of Virtual DOM in React? (MOCK DATA - FALLBACK ACTIVE)";
          return questions;
        };
        return await mockGenerateQuestions();
    }
};

/**
 * Uses Gemini API to score an answer and provide feedback.
 * @returns {{score: number, feedback: string}}
 */
const judgeAnswer = async (question, answer) => {
    console.log('Judging answer using Gemini API...');
    
    const systemPrompt = `You are a professional full-stack interview grader. Review the candidate's answer for the following question, which is for a React/Node role. Score the answer from 0 to 100 (where 100 is excellent). Provide detailed, constructive feedback.`;
    
    const userQuery = `Question Level: ${question.level}\nQuestion: ${question.text}\nCandidate Answer: ${answer}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "score": { "type": "NUMBER", "description": "The score of the answer, from 0 to 100." },
                    "feedback": { "type": "STRING", "description": "Detailed, constructive feedback for the candidate." }
                },
                "required": ["score", "feedback"]
            }
        }
    };

    const apiCall = async () => {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("AI failed to return structured judging data.");
        
        const parsedResult = JSON.parse(jsonText);
        console.log('Answer Judging: SUCCESS');
        return {
            score: parsedResult.score,
            feedback: parsedResult.feedback
        };
    };

    // Fallback to mock data if API fails or is not supported
    try {
        return await withBackoff(apiCall);
    } catch (e) {
        console.error("AI Answer Judging FAILED. Using mock data.", e);
        // Note: mockJudgeAnswer is defined in the fallback to avoid hoisting issues
        const mockJudgeAnswer = async (question, answer) => {
          const score = 50 + Math.floor(Math.random() * 50); 
          const feedback = `(MOCK Feedback - FALLBACK ACTIVE) Your answer addressed the core concept of ${question.level} questions effectively, earning a score of ${score}/100. ${answer.length < 50 ? 'Your answer was quite brief.' : 'It was a comprehensive response.'}`;
          return { score, feedback };
        };
        return await mockJudgeAnswer(question, answer);
    }
};

/**
 * Uses Gemini API to generate a final summary and score.
 * @returns {{finalScore: number, finalSummary: string}}
 */
const generateSummary = async (questions) => {
    console.log('Generating final summary using Gemini API...');
    
    const systemPrompt = `You are a hiring manager. Analyze the candidate's performance across all 6 questions. Provide a final overall score (0-100) and a concise, professional summary covering strengths and weaknesses for the full-stack role.`;
    
    const history = questions.map(q => 
        `Q (${q.level}, Score: ${q.aiScore}/100): ${q.text}\nAnswer: ${q.candidateAnswer}`
    ).join('\n---\n');

    const userQuery = `Here is the full interview transcript:\n\n${history}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    "finalScore": { "type": "NUMBER", "description": "The final overall score for the candidate, from 0 to 100." },
                    "finalSummary": { "type": "STRING", "description": "A concise, professional summary of the candidate's performance." }
                },
                "required": ["finalScore", "finalSummary"]
            }
        }
    };

    const apiCall = async () => {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent?key=${API_KEY}`;
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("AI failed to return structured summary data.");
        
        console.log('Summary Generation: SUCCESS');
        return JSON.parse(jsonText);
    };

    // Fallback to mock data if API fails or is not supported
    try {
        return await withBackoff(apiCall);
    } catch (e) {
        console.error("AI Summary Generation FAILED. Using mock data.", e);
        // Note: mockGenerateSummary is defined in the fallback to avoid hoisting issues
        const mockGenerateSummary = async (questions) => {
          const validScores = questions.map(q => q.aiScore).filter(score => score !== null);
          const totalScore = validScores.reduce((sum, score) => sum + score, 0) / (validScores.length || 1);
          const summary = `(MOCK Summary - FALLBACK ACTIVE) Candidate demonstrated good foundational knowledge in Easy questions. Overall score: ${Math.round(totalScore)}/100 based on ${validScores.length} answers.`;
          return { finalScore: Math.round(totalScore), finalSummary: summary };
        };
        return await mockGenerateSummary(questions);
    }
};


// --- HOOK FOR PERSISTENCE ---

/**
 * Custom hook to manage state and local storage persistence for the entire app.
 */
const usePersistentState = (initialState) => {
  const [state, setState] = useState(() => {
    try {
      const storedValue = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedValue) {
        // Attempt to parse and return stored state
        return JSON.parse(storedValue);
      }
    } catch (error) {
      console.error("Error reading localStorage, using initial state:", error);
    }
    return initialState;
  });

  useEffect(() => {
    try {
      // Persist state to local storage whenever it changes
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Error writing to localStorage:", error);
    }
  }, [state]);

  return [state, setState];
};


// --- COMPONENTS ---

const WelcomeBackModal = ({ activeCandidate, onClose, onNewSession }) => {
  const isInProgress = activeCandidate.status === 'In Progress' || activeCandidate.status === 'Collecting Info';

  if (!isInProgress) return null;

  const progressCount = activeCandidate.interviewProgress.questions.filter(q => q.candidateAnswer).length;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg transform transition-all">
        <h2 className="text-3xl font-bold text-indigo-700 mb-4">Welcome Back!</h2>
        <p className="text-gray-700 mb-6">
          It looks like you have an ongoing session. Would you like to **resume** the interview or start a **new one**?
        </p>
        <div className="space-y-2">
          <p className="font-semibold">Current Status:</p>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span>
                {activeCandidate.status === 'Collecting Info'
                    ? 'Collecting Profile Info'
                    : `${progressCount} questions answered.`
                }
            </span>
          </div>
        </div>
        <div className="mt-8 flex justify-end space-x-4">
          <button
            onClick={onNewSession}
            className="px-6 py-3 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition"
          >
            Start New Session
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition shadow-md"
          >
            <Play className="w-5 h-5 inline mr-2" />
            Resume Session
          </button>
        </div>
      </div>
    </div>
  );
};


const IntervieweeChat = ({ activeCandidate, setActiveCandidate, isLoading, setIsLoading, resetSession }) => {
  const [resumeFile, setResumeFile] = useState(null);
  const [currentInput, setCurrentInput] = useState('');
  const chatEndRef = useRef(null);

  // Scroll to the bottom of the chat history whenever a message is added
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeCandidate.chatHistory.length]);

  /**
   * Core logic for AI judging, updating state, and advancing the interview.
   */
  const processAnswerAndNextQuestion = useCallback(async (question, answer, questionIndex) => {
    setIsLoading(true);

    try {
      // 1. Judge Answer using Gemini API
      const { score, feedback } = await judgeAnswer(question, answer);
      
      const isLastQuestion = questionIndex === QUESTION_LEVELS.length - 1;

      // 2. Prepare state updates for the current question
      let newQuestions = [...activeCandidate.interviewProgress.questions];
      newQuestions[questionIndex] = {
        ...question,
        candidateAnswer: answer,
        aiScore: score,
        aiFeedback: feedback,
      };

      let newChatHistory = [
        ...activeCandidate.chatHistory,
        { type: 'system', content: `[Q${questionIndex + 1} Judged] Score: ${score}/100.`, timestamp: Date.now() },
      ];

      let newStatus = activeCandidate.status;
      let nextQuestionIndex = questionIndex + 1;
      let nextTimer = 0;
      let finalScore = null;
      let finalSummary = '';

      if (isLastQuestion) {
        // 3. Final Step: Generate Summary using Gemini API
        const summaryData = await generateSummary(newQuestions);
        finalScore = summaryData.finalScore;
        finalSummary = summaryData.finalSummary;
        newStatus = 'Completed';
        newChatHistory.push({ type: 'system', content: `Interview finished. Calculating final score and summary...`, timestamp: Date.now() });
      } else {
        // 4. Advance to Next Question
        const nextQuestion = newQuestions[nextQuestionIndex];
        nextTimer = nextQuestion.timerMax;
        newChatHistory.push({ type: 'ai-question', content: nextQuestion.text, timestamp: Date.now() });
      }

      // 5. Update Candidate State
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
      alert("An error occurred while processing the answer. Please check the console.");
      // Keep status as 'In Progress' and remain on the current question
    } finally {
      setIsLoading(false);
    }
  }, [activeCandidate.chatHistory, activeCandidate.interviewProgress.questions, setActiveCandidate, setIsLoading]);


  /**
   * Function to handle both manual and auto-submission of an answer.
   * @param {string} answer - The text submitted by the candidate.
   * @param {boolean} isTimedOut - True if submitted by the timer.
   */
  const handleSubmission = useCallback((answer, isTimedOut) => {
    const { currentQuestionIndex, questions } = activeCandidate.interviewProgress;
    const currentQuestion = questions[currentQuestionIndex];

    if (!currentQuestion) return;

    if (isTimedOut) {
        // Add a system message for time out before processing
        setActiveCandidate(prev => ({
            ...prev,
            chatHistory: [
                ...prev.chatHistory,
                { type: 'system', content: `Time is up! Submitting answer automatically: "${answer || 'No answer provided'}"`, timestamp: Date.now() }
            ],
        }));
    }

    // Process the answer, move to the next step, and handle finalization
    processAnswerAndNextQuestion(currentQuestion, answer, currentQuestionIndex);
    setCurrentInput(''); // Clear input after submission
  }, [activeCandidate.interviewProgress, setActiveCandidate, processAnswerAndNextQuestion]);


  /**
   * Effect for the timer countdown.
   */
  useEffect(() => {
    let timerId;
    const { status, interviewProgress } = activeCandidate;
    const { currentTimer, isPaused } = interviewProgress;
    
    const isInterviewRunning = status === 'In Progress' && !isPaused && !isLoading;

    if (isInterviewRunning && currentTimer > 0) {
      timerId = setInterval(() => {
        setActiveCandidate(prev => ({
          ...prev,
          interviewProgress: {
            ...prev.interviewProgress,
            currentTimer: prev.interviewProgress.currentTimer - 1,
          },
        }));
      }, 1000);
    } else if (isInterviewRunning && currentTimer === 0) {
        // Time out, automatically submit the current input
        handleSubmission(currentInput, true); 
    }

    return () => clearInterval(timerId);
  }, [activeCandidate, handleSubmission, isLoading, currentInput, setActiveCandidate]);


  /**
   * Starts the interview: generates questions, sets the initial timer, and transitions status.
   * NOTE: Using the new 'generateQuestions' function.
   */
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
      alert("Failed to generate questions. Please try again.");
      // Revert to collecting info if question generation fails
      setActiveCandidate(prev => ({ ...prev, status: 'Collecting Info', chatHistory: [...prev.chatHistory, { type: 'system', content: 'ERROR: Could not start interview (AI issue). Please start a new session.', timestamp: Date.now() }] }));
    } finally {
      setIsLoading(false);
    }
  }, [setActiveCandidate, setIsLoading]);


  /**
   * Effect to start the interview immediately after profile collection is complete.
   */
  useEffect(() => {
    if (activeCandidate.status === 'Starting Interview') {
      // Use a timeout to ensure the final "All details confirmed" message is rendered
      const timeout = setTimeout(() => {
        startInterview();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [activeCandidate.status, startInterview]);


  /**
   * Handles the processing of the uploaded resume file.
   */
  const handleResumeUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (activeCandidate.status !== 'Pending Resume') {
      alert("A session is already active. Please use the 'Start New Session' button to begin a new one.");
      return;
    }

    setResumeFile(file);
    setIsLoading(true);

    try {
      // 1. Read file content as Base64 string
      const base64Data = await fileToBase64(file);

      // 2. Use AI to parse the content
      const extractedData = await parseResumeWithAI(base64Data, file.type);
      
      let newCandidate = {
        ...activeCandidate,
        name: extractedData.name,
        email: extractedData.email,
        phone: extractedData.phone,
        chatHistory: [
          ...activeCandidate.chatHistory,
          { type: 'system', content: `Resume "${file.name}" uploaded successfully.`, timestamp: Date.now() },
        ]
      };
      
      // NEW: Add a summary message to the chat
      const summaryContent = `**Resume Parsing Complete**\n\n- **Name:** ${extractedData.name || 'N/A'}\n- **Email:** ${extractedData.email || 'N/A'}\n- **Phone:** ${extractedData.phone || 'N/A'}`;
      newCandidate.chatHistory.push({
          type: 'system',
          content: summaryContent,
          timestamp: Date.now(),
      });


      // 3. Check for missing fields
      const nextField = getNextMissingField(newCandidate);
      
      if (nextField) {
        newCandidate.status = 'Collecting Info';
        newCandidate.chatHistory.push({
            type: 'ai-question',
            content: `Hello ${extractedData.name || 'Candidate'}! Before we start, I need your **${nextField}**. Please provide it below.`,
            timestamp: Date.now()
        });
      } else {
        newCandidate.status = 'Starting Interview';
        newCandidate.chatHistory.push({
            type: 'system',
            content: "Thank you! All required details are confirmed. Starting the interview now...",
            timestamp: Date.now()
        });
      }
      
      setActiveCandidate(() => newCandidate);
      
    } catch (error) {
      alert("Error processing resume. Please try a different file or start a new session.");
      console.error("Resume Upload Error:", error);
      setResumeFile(null);
      setActiveCandidate(prev => ({ ...prev, status: 'Pending Resume', chatHistory: [...prev.chatHistory, { type: 'system', content: 'ERROR: Failed to process resume. Please try again.', timestamp: Date.now() }] }));
    } finally {
      setIsLoading(false);
    }
  };


  /**
   * Logic for collecting missing fields (Name, Email, Phone) one by one.
   */
  const collectMissingInfo = (input) => {
    const fieldToCollect = getNextMissingField(activeCandidate);
    if (!fieldToCollect) return;

    let updateObject = {};
    let successMessage = null;
    let isValid = true;

    if (fieldToCollect === 'Name') {
        updateObject = { name: input };
        successMessage = `Thank you, ${input}!`;
    } else if (fieldToCollect === 'Email') {
        if (validateEmail(input)) {
            updateObject = { email: input };
            successMessage = `Got the email: ${input}.`;
        } else {
            isValid = false;
        }
    } else if (fieldToCollect === 'Phone') {
        if (validatePhone(input)) {
            updateObject = { phone: input };
            successMessage = `Got the phone number: ${input}.`;
        } else {
            isValid = false;
        }
    }

    if (!isValid) {
        setActiveCandidate(prev => ({
            ...prev,
            chatHistory: [...prev.chatHistory, { type: 'system', content: `That doesn't look like a valid ${fieldToCollect}. Please try again.`, timestamp: Date.now() }]
        }));
        return;
    }

    // Apply the update
    let tempCandidate = { ...activeCandidate, ...updateObject };
    const nextField = getNextMissingField(tempCandidate);

    if (nextField) {
        // Still collecting
        setActiveCandidate(prev => ({
            ...prev,
            ...updateObject,
            chatHistory: [
                ...prev.chatHistory,
                { type: 'ai-question', content: `${successMessage} Now, please provide your **${nextField}**.`, timestamp: Date.now() }
            ]
        }));
    } else {
        // Collection complete, transition to start interview
        setActiveCandidate(prev => ({
            ...prev,
            ...updateObject,
            status: 'Starting Interview', // Triggers the useEffect to call startInterview
            chatHistory: [
                ...prev.chatHistory,
                { type: 'system', content: `${successMessage} All details confirmed. Starting the interview now...`, timestamp: Date.now() }
            ]
        }));
    }
  };


  /**
   * Main chat input send handler.
   */
  const handleSend = async () => {
    const input = currentInput.trim();
    if (!input || isLoading || activeCandidate.interviewProgress.isPaused) return;

    // 1. Add user message to chat history
    setActiveCandidate(prev => ({
        ...prev,
        chatHistory: [
            ...prev.chatHistory,
            { type: 'user', content: input, timestamp: Date.now() }
        ]
    }));
    setCurrentInput('');

    // 2. Handle status-specific actions
    if (activeCandidate.status === 'Collecting Info') {
        collectMissingInfo(input);
    } else if (activeCandidate.status === 'In Progress') {
        // Manual submission of answer
        handleSubmission(input, false);
    } 
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
    }
  };

  const getButtonText = () => {
    if (activeCandidate.status === 'Pending Resume') return 'Upload Resume to Start';
    if (activeCandidate.status === 'Collecting Info') return 'Provide Missing Details';
    if (activeCandidate.status === 'Starting Interview') return 'Preparing...';
    if (activeCandidate.status === 'In Progress') return 'Submit Answer';
    if (activeCandidate.status === 'Completed') return 'View Summary';
    return 'Start';
  };

  const isInterviewActive = activeCandidate.status === 'In Progress';
  const isFinished = activeCandidate.status === 'Completed';
  const isInputDisabled = isLoading || isFinished || activeCandidate.status === 'Starting Interview';

  const currentQ = activeCandidate.interviewProgress.questions[activeCandidate.interviewProgress.currentQuestionIndex];

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-xl shadow-inner">
      <header className="p-4 border-b bg-white rounded-t-xl flex justify-between items-center shadow-sm flex-wrap sm:flex-nowrap">
        <h2 className="text-xl font-bold text-indigo-700 w-full sm:w-auto mb-2 sm:mb-0">Interview Chat</h2>
        <div className="text-sm font-medium text-gray-600 flex flex-wrap items-center justify-end w-full sm:w-auto">
            {isInterviewActive && currentQ && (
                <>
                    <span className={`text-sm font-bold px-2 py-1 rounded-full mr-3 ${
                        currentQ.level === 'Easy' ? 'bg-green-100 text-green-700' :
                        currentQ.level === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                    }`}>
                        {currentQ.level}
                    </span>
                    <Clock className="w-4 h-4 mr-1 text-red-500 animate-pulse" />
                    <span className="text-red-600 font-mono">Timer: {activeCandidate.interviewProgress.currentTimer}s</span>
                    <button
                        onClick={() => setActiveCandidate(prev => ({ ...prev, interviewProgress: { ...prev.interviewProgress, isPaused: !prev.interviewProgress.isPaused } }))}
                        className={`ml-3 px-3 py-1 text-sm rounded-full transition ${activeCandidate.interviewProgress.isPaused ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}
                        disabled={isLoading}
                    >
                        {activeCandidate.interviewProgress.isPaused ? <><Play className="w-4 h-4 inline mr-1" />Resume</> : <><Pause className="w-4 h-4 inline mr-1" />Pause</>}
                    </button>
                </>
            )}
            <button
                onClick={resetSession}
                className="ml-0 sm:ml-3 mt-2 sm:mt-0 px-3 py-1 text-sm rounded-full bg-red-100 text-red-700 font-semibold hover:bg-red-200 transition"
                disabled={isLoading}
            >
                New Session
            </button>
        </div>
      </header>

      {/* Chat History Area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {activeCandidate.chatHistory.map((msg, index) => (
          <div key={index} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] p-3 rounded-xl shadow-md ${
                msg.type === 'user'
                  ? 'bg-indigo-500 text-white rounded-br-none'
                  : msg.type === 'ai-question'
                  ? 'bg-indigo-100 text-indigo-900 font-medium border-l-4 border-indigo-500'
                  : 'bg-white text-gray-800 shadow-lg'
              }`}>
              {/* Render content, allowing markdown bolding for the summary */}
              <p className={msg.type === 'ai-question' ? 'font-bold' : ''}>
                  {msg.content.split('\n').map((line, i) => {
                      if (line.startsWith('**Resume Parsing Complete**')) {
                          return <strong key={i} className="block mb-2">{line.replace(/\*\*/g, '')}</strong>;
                      }
                      // Basic markdown for list items in the summary
                      const match = line.match(/^- \*\*(\w+):\*\* (.+)/);
                      if (match) {
                          return <span key={i} className="block text-sm"><strong>{match[1]}:</strong> {match[2]}</span>;
                      }
                      return <span key={i} className="block">{line}</span>;
                  })}
              </p>
              <span className="text-xs text-opacity-70 mt-1 block text-right">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-700 p-3 rounded-xl shadow-md">
              <div className="flex items-center space-x-2">
                <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{isInterviewActive ? 'AI is grading...' : activeCandidate.status === 'Pending Resume' ? 'Parsing Resume...' : 'AI is thinking...'}</span>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input/Upload Area */}
      <div className="p-4 border-t bg-white rounded-b-xl">
        {isFinished ? (
            <div className='p-4 text-center bg-green-50 rounded-lg text-green-700 font-semibold'>
                Interview Completed! Final Score: {activeCandidate.finalScore}%
            </div>
        ) : activeCandidate.status === 'Pending Resume' ? (
            <label className="flex items-center justify-center p-4 border-2 border-dashed border-indigo-300 rounded-xl cursor-pointer bg-indigo-50 hover:bg-indigo-100 transition">
                <Upload className="w-5 h-5 mr-2 text-indigo-600" />
                <span className="text-indigo-700 font-semibold">
                    {resumeFile ? `Selected: ${resumeFile.name}` : getButtonText()}
                </span>
                <input type="file" className="hidden" accept=".pdf,.docx" onChange={handleResumeUpload} disabled={isLoading} />
            </label>
        ) : (
            <div className="flex space-x-2 items-end">
                <textarea
                    className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    placeholder={activeCandidate.status === 'Collecting Info' ? 'Enter missing detail(s)...' : 'Type your answer here...'}
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows="1"
                    disabled={isInputDisabled || activeCandidate.interviewProgress.isPaused}
                />
                <button
                    onClick={handleSend}
                    className="flex items-center justify-center px-4 h-12 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition shadow-md disabled:opacity-50"
                    disabled={isInputDisabled || (!currentInput.trim() && isInterviewActive) || activeCandidate.interviewProgress.isPaused}
                    title="Send (Enter)"
                >
                    <CornerDownLeft className="w-5 h-5" />
                    <span className='ml-2 hidden sm:inline'>{getButtonText().split(' ')[0]}</span>
                </button>
            </div>
        )}
      </div>
    </div>
  );
};


const InterviewerDashboard = ({ candidates, setActiveCandidate }) => {
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [sortKey, setSortKey] = useState('finalScore');
    const [sortDirection, setSortDirection] = useState('desc');
    const [searchTerm, setSearchTerm] = useState('');

    const completedCandidates = candidates.filter(c => c.status !== 'Pending Resume'); // Show any candidate who has uploaded a resume

    const sortedCandidates = [...completedCandidates]
        .filter(c => 
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            c.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.id.includes(searchTerm.toLowerCase()) // Allow search by ID for debugging/tracking
        )
        .sort((a, b) => {
            // Treat null scores as -1 for sorting purposes (so incomplete sessions go to the bottom)
            let aValue = a.finalScore === null ? -1 : a.finalScore;
            let bValue = b.finalScore === null ? -1 : b.finalScore;

            if (sortKey === 'finalScore') {
                return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
            }
            // Default to name comparison
            return sortDirection === 'asc' ? String(a.name).localeCompare(String(b.name)) : String(b.name).localeCompare(String(a.name));
        });

    const handleSort = (key) => {
        if (key === 'status') return; // Do not allow sorting by status for simplicity
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('desc');
        }
    };
    
    // Helper component for sort indicators
    const SortIndicator = ({ columnKey }) => {
        if (sortKey !== columnKey) return <ChevronDown className="w-4 h-4 ml-1 opacity-30" />;
        return sortDirection === 'asc' ? <ArrowUp className="w-4 h-4 ml-1" /> : <ArrowDown className="w-4 h-4 ml-1" />;
    };


    if (selectedCandidate) {
        const candidateData = candidates.find(c => c.id === selectedCandidate.id);
        if (!candidateData) return <div>Candidate not found.</div>;

        return (
            <div className="p-4 sm:p-6 bg-white rounded-xl shadow-lg h-full overflow-y-auto">
                <button
                    onClick={() => setSelectedCandidate(null)}
                    className="mb-4 sm:mb-6 text-indigo-600 font-semibold hover:text-indigo-800 transition flex items-center"
                >
                    &larr; Back to Dashboard
                </button>
                <h2 className="text-2xl sm:text-3xl font-bold text-indigo-800 mb-6 border-b pb-2">{candidateData.name || 'Candidate'}'s Performance Review</h2>

                {/* Profile and Summary */}
                <div className="grid md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
                    <div className="p-4 border rounded-xl bg-gray-50">
                        <h3 className="text-lg sm:text-xl font-semibold mb-2 text-gray-700">Candidate Profile</h3>
                        <p><strong>Name:</strong> {candidateData.name || 'N/A'}</p>
                        <p><strong>Email:</strong> {candidateData.email || 'N/A'}</p>
                        <p><strong>Phone:</strong> {candidateData.phone || 'N/A'}</p>
                        <p><strong>Session ID:</strong> <span className='text-xs font-mono bg-gray-200 px-2 py-0.5 rounded'>{candidateData.id}</span></p>
                        <p className='mt-2'><strong>Status:</strong> <span className={`font-bold ${
                            candidateData.status === 'Completed' ? 'text-green-600' : 
                            candidateData.status === 'In Progress' ? 'text-yellow-600' :
                            'text-indigo-600'
                        }`}>{candidateData.status}</span></p>
                    </div>
                    <div className="p-4 border rounded-xl bg-indigo-50">
                        <h3 className="text-lg sm:text-xl font-semibold mb-2 text-indigo-700">AI Final Summary</h3>
                        <p className="text-4xl sm:text-5xl font-extrabold text-indigo-600 mb-2">{candidateData.finalScore ? `${candidateData.finalScore}%` : 'N/A'}</p>
                        <p className='text-gray-800 italic text-sm sm:text-base'>{candidateData.finalSummary || 'Summary will be available upon completion of all 6 questions.'}</p>
                    </div>
                </div>

                {/* Question Breakdown */}
                <h3 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4">Interview Breakdown ({candidateData.interviewProgress.questions.length} Questions)</h3>
                <div className="space-y-4 sm:space-y-6">
                    {candidateData.interviewProgress.questions.map((q, index) => (
                        <div key={q.id} className="border p-4 rounded-xl shadow-md bg-white">
                            <div className="flex justify-between items-start sm:items-center mb-2 flex-col sm:flex-row">
                                <span className={`px-3 py-1 text-xs font-bold rounded-full mb-2 sm:mb-0 ${
                                    q.level === 'Easy' ? 'bg-green-100 text-green-700' :
                                    q.level === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-red-100 text-red-700'
                                }`}>
                                    {q.level} (Q{index + 1}/6)
                                </span>
                                <span className="text-base sm:text-lg font-bold text-gray-700">Score: {q.aiScore !== null ? `${q.aiScore}/100` : 'Pending'}</span>
                            </div>
                            <p className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">Question: {q.text}</p>
                            <div className="ml-0 sm:ml-4 border-l-0 sm:border-l-2 pl-0 sm:pl-3 mt-3">
                                <p className="text-sm font-semibold text-indigo-500 mb-1">Candidate Answer:</p>
                                <p className="text-gray-800 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap text-xs sm:text-sm">{q.candidateAnswer || 'No answer submitted.'}</p>
                                {q.aiFeedback && (
                                    <>
                                        <p className="text-sm font-semibold text-indigo-500 mt-3 mb-1">AI Feedback:</p>
                                        <p className="text-gray-800 bg-indigo-100 p-3 rounded-lg whitespace-pre-wrap text-xs sm:text-sm">{q.aiFeedback}</p>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // List View
    return (
        <div className="p-4 md:p-6 bg-white rounded-xl shadow-lg h-full flex flex-col">
            <h2 className="text-2xl font-bold text-indigo-700 mb-4">Interviewer Dashboard (Candidate List)</h2>

            <div className="mb-4">
                <div className="relative flex-grow">
                    <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by Name, Email, or ID..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="overflow-x-auto flex-1">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th 
                                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                                onClick={() => handleSort('name')}
                            >
                                <div className="flex items-center whitespace-nowrap">
                                    Name
                                    <SortIndicator columnKey="name" />
                                </div>
                            </th>
                            <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Email
                            </th>
                            <th
                                className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer whitespace-nowrap"
                                onClick={() => handleSort('finalScore')}
                            >
                                <div className="flex items-center">
                                    Score
                                    <SortIndicator columnKey="finalScore" />
                                </div>
                            </th>
                            <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                            </th>
                            <th className="px-3 sm:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                View
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedCandidates.length > 0 ? (
                            sortedCandidates.map((c) => (
                                <tr key={c.id} className="hover:bg-indigo-50 transition duration-150">
                                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{c.name || 'N/A'}</td>
                                    <td className="hidden sm:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.email || 'N/A'}</td>
                                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm font-bold">
                                        {c.finalScore !== null ? <span className='text-indigo-600'>{c.finalScore}%</span> : <span className='text-yellow-600'>Pending</span>}
                                    </td>
                                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            c.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                        }`}>
                                            {c.status === 'Starting Interview' ? 'In Progress' : c.status}
                                        </span>
                                    </td>
                                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => setSelectedCandidate(c)}
                                            className="text-indigo-600 hover:text-indigo-900 transition font-semibold"
                                        >
                                            View &rarr;
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="5" className="px-6 py-4 text-center text-gray-500">No candidates match your search.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

export default function App() {
  const [appState, setAppState] = usePersistentState({
    activeTab: 'interviewee', // 'interviewee' or 'interviewer'
    candidates: [initialCandidateState], // Array of all candidates
    showWelcomeModal: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const { activeTab, candidates, showWelcomeModal } = appState;

  // Always use the last candidate in the array as the active session
  const activeCandidate = candidates[candidates.length - 1];

  // Helper function to update the active candidate's state
  const setActiveCandidate = (updater) => {
    setAppState(prev => {
      const updatedCandidates = [...prev.candidates];
      const newActiveCandidate = typeof updater === 'function' ? updater(updatedCandidates[updatedCandidates.length - 1]) : updater;
      updatedCandidates[updatedCandidates.length - 1] = newActiveCandidate;
      return { ...prev, candidates: updatedCandidates };
    });
  };

  // Check for an interrupted session on initial load (only once)
  useEffect(() => {
    const isCollectingOrInProgress = activeCandidate.status !== 'Completed' && activeCandidate.status !== 'Pending Resume' && activeCandidate.status !== 'Starting Interview';
    setAppState(prev => ({ ...prev, showWelcomeModal: isCollectingOrInProgress }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resets the current candidate state to start a new session
  const resetSession = useCallback(() => {
    setAppState(prev => ({
      ...prev,
      candidates: [...prev.candidates, initialCandidateState],
      showWelcomeModal: false,
    }));
  }, [setAppState]);

  // Handle resume from modal
  const handleResume = () => {
    setAppState(prev => ({ ...prev, showWelcomeModal: false }));
    setAppState(prev => ({ ...prev, activeTab: 'interviewee' }));
  };


  return (
    // MODIFIED: Increased padding on mobile (p-0) and used px-4 on main wrapper for padding on mobile
    <div className="min-h-screen bg-gray-100 p-0 sm:p-4 md:p-8 font-sans w-full"> 
        <h1 className="text-2xl sm:text-4xl font-extrabold text-center text-indigo-800 mb-4 sm:mb-6">
            AI Interview Assistant
        </h1>

        <div className="w-full"> 
            {/* Tabs Navigation */}
            <div className="flex border-b border-gray-200 mb-4 sm:mb-6 px-4 sm:px-0">
            <TabButton
                icon={MessageSquare}
                label="Interviewee (Chat)"
                active={activeTab === 'interviewee'}
                onClick={() => setAppState(prev => ({ ...prev, activeTab: 'interviewee' }))}
            />
            <TabButton
                icon={Users}
                label="Interviewer (Dashboard)"
                active={activeTab === 'interviewer'}
                onClick={() => setAppState(prev => ({ ...prev, activeTab: 'interviewer' }))}
            />
            </div>

            {/* Main Content Area: Use full height on mobile (h-full) and constrained height on desktop */}
            <div className="h-full min-h-[600px] shadow-2xl rounded-xl mx-auto max-w-full lg:max-w-6xl">
            {activeTab === 'interviewee' ? (
                <IntervieweeChat
                activeCandidate={activeCandidate}
                setActiveCandidate={setActiveCandidate}
                isLoading={isLoading}
                setIsLoading={setIsLoading}
                resetSession={resetSession}
                />
            ) : (
                <InterviewerDashboard candidates={candidates} setActiveCandidate={setActiveCandidate} />
            )}
            </div>
        </div>

        {/* Welcome Back Modal */}
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

// Reusable Tab Button Component
const TabButton = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center px-3 sm:px-4 py-3 text-xs sm:text-sm font-semibold rounded-t-lg transition-all duration-200 ${
      active
        ? 'text-indigo-600 border-b-4 border-indigo-600 bg-white'
        : 'text-gray-500 hover:text-indigo-600 hover:bg-gray-100'
    }`}
  >
    <Icon className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
    {label}
  </button>
);
