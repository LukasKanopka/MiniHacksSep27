# Skillpool: An Intelligent Talent Discovery Engine 🚀

**An intelligent search application that uses graph-based Retrieval Augmented Generation (RAG) to provide deep insights into your organization's talent pool.**

[![Watch the Demo](https://img.youtube.com/vi/LRe_BwuoKtg/0.jpg)](https://www.youtube.com/watch?v=LRe_BwuoKtg)

**[Watch the Full Demo Here](https://www.youtube.com/watch?v=LRe_BwuoKtg)**

---

## 🎯 The Problem

In any large organization, a significant challenge for project managers is identifying and connecting with the right talent for new projects. Critical expertise is often buried in a sea of documents, reports, and resumes scattered across the company. Traditional keyword searches are frequently inefficient—either too broad to be useful or too narrow to find the best fit.

This leads to:
* **Wasted time** and missed connections.
* Projects being staffed based on **availability**, not expertise.
* Sub-optimal team composition, especially in specialized fields like science and technology where the right talent is crucial for success.

---

## ✨ Our Solution: Skillpool

**Skillpool** is an intelligent talent discovery engine designed to solve this problem. It functions as a sophisticated search application that leverages a **Knowledge Graph** and **Retrieval Augmented Generation (RAG)** to map and reveal the skills, experience, and hidden connections within your organization.

By ingesting a massive corpus of data—including employee resumes, project histories, and company documents—Skillpool builds a dynamic graph database of your entire talent pool. This allows project managers to move beyond simple keywords and ask natural language questions to find the most qualified people for the job, complete with the evidence to support their selection.

---

## 🔑 Key Features

* **Deep Insight Discovery:** Utilizes a knowledge graph to uncover non-obvious relationships between people, skills, and projects across thousands of documents. This allows for insights that standard semantic search would miss.
* **Natural Language Queries:** Ask questions in plain English, just like you would ask a colleague (e.g., "Find me a senior developer with JavaScript experience").
* **Evidence-Backed Results:** Every recommendation is backed by concrete data drawn directly from the source documents, providing clear justification for each choice.
* **Increased Efficiency:** Drastically reduces the time and effort required for talent discovery and project staffing, enabling managers to build optimal teams faster.

---

## ⚙️ How It Works

Skillpool follows a multi-stage process to deliver concise, actionable answers from your organization's data.

1.  **Data Ingestion (Python):** The system reads and processes documents like resumes and project reports. The text is chunked, and **OpenAI's embedding models** are used to create vector representations of the content.
2.  **Knowledge Graph Creation (Neo4j):** The processed data and its vector embeddings are used to build a robust graph database in **Neo4j**. This graph maps out all the entities (like employees, skills, projects) and the relationships between them.
3.  **Search & Synthesis (Gemini API):** When a user enters a query, an embedding is generated for the question. A vector search is performed on the Neo4j database to find the most relevant nodes. These results are then passed to a Large Language Model (**Gemini API**) to synthesize a clear and actionable answer.

---

### Entity Relationship Diagram
The core of our application is the knowledge graph, which connects people to their skills and projects, creating a rich, queryable network of expertise.



---

## 🛠️ Tech Stack

* **Frontend:** A modern and responsive web application built with **Next.js** and **TypeScript**.
* **Backend:** A scalable, serverless architecture using **Netlify Functions** for easy deployment and management.
* **Data Ingestion & Embeddings:** **Python** with the **OpenAI API**.
* **Database:** **Neo4j** for our knowledge graph and vector search.
* **LLM for Synthesis:** **Google's Gemini API**.

---

## 📋 Getting Started

To get a local copy up and running, please follow these steps.

### Prerequisites

* Node.js
* Python 3.x
* Neo4j Account
* OpenAI API Key
* Google Gemini API Key

### Installation

1.  Clone the repo
    ```sh
    git clone [https://github.com/your_username/skillpool.git](https://github.com/your_username/skillpool.git)
    ```
2.  Install NPM packages for the frontend
    ```sh
    cd frontend/skillpoolfrontendonlylg234
    npm install
    ```
3.  Set up the Python environment for data ingestion
    ```sh
    cd ../../neo4j
    pip install -r requirements.txt
    ```
4.  Configure your environment variables in a `.env` file based on the provided `.env.example`.

---

## 👤 Contact

Project by Laurynas Lukas Kanopka, Yanka Deshkovski, Gabriel Wong, Lucas G.
