# AI-Powered Interview Assistant
This project is an implementation of an AI-powered interview assistant, designed as a full-stack technical assessment simulator for a Full Stack (React/Node) role. The application features a synchronized chat interface for the Interviewee and a Dashboard for the Interviewer, with comprehensive data persistence and dynamic question generation using the Google Gemini API.

🚀 Key Features
This application was built to fulfill all core assignment requirements:

Feature

Implementation Detail

AI-Powered Interview

Dynamically generates a sequence of 6 questions (2 Easy, 2 Medium, 2 Hard).

Timed Answers

Each question has a time limit (20s, 60s, or 120s). The system automatically submits the answer if time runs out.

AI Scoring & Summary

Uses the Gemini API to judge each answer (0-100 score + feedback) and generates a final comprehensive summary and score after the 6th question.

Resume Parsing

Uses the Gemini API's Multimodal capability to parse uploaded PDF/DOCX files and extract Name, Email, and Phone.

Missing Info Collection

If profile fields are missing from the resume, a chatbot flow collects the data before the interview starts.

Local Data Persistence

All interview progress, chat history, and candidate profiles are saved locally using localStorage, ensuring progress is restored upon refresh or reopening.

Welcome Back Modal

A modal prompts the user to resume an in-progress session on application load.

Interviewer Dashboard

Displays a list of all candidates, allows search and sort (by Name/Score), and provides a detailed breakdown of the full chat, answers, and individual AI scores.

Responsive Design

Built with Tailwind CSS for optimal viewing and interaction on mobile, tablet, and desktop devices.

🛠️ Technology Stack
Frontend: React (Vite)

Styling: Tailwind CSS

State Management: React Hooks (useState, useEffect) with custom persistence layer.

Persistence: localStorage (simulating redux-persist).

AI Integration: Google Gemini API (gemini-2.5-flash-preview-05-20) for:

Resume parsing (multimodal capability)

Dynamic question generation (structured JSON)

Answer judging and scoring (structured JSON)

Final summary generation (structured JSON)

⚙️ Setup and Installation
Follow these steps to get the project running on your local machine.

1. Clone the Repository
git clone <YOUR_REPO_URL>
cd ai-interview-assistant

2. Install Dependencies
This project uses a standard Node.js setup:

npm install

3. Configure API Key
The application requires a Gemini API Key for all AI functionality.

Obtain your API Key from Google AI Studio.

Create a file named .env in the root directory of the project.

Add your key to the file using the following format:

VITE_GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY_HERE"

Note: The code is configured to read this environment variable using import.meta.env.VITE_GEMINI_API_KEY for secure access via Vite.

4. Run the Application
Start the development server:

npm run dev

The application will typically be available at http://localhost:5173/.

☁️ Deployment (Netlify)
The application is built to be easily deployed to services like Netlify or Vercel.

When deploying to Netlify:

Connect the repository.

Set Build command to npm run build.

Set Publish directory to dist.

Crucially, configure the Environment Variable in the Netlify dashboard:

Key: VITE_GEMINI_API_KEY

Value: Your actual Gemini API Key.
