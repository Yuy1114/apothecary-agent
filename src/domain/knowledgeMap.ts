export type KnowledgeTopicCategory =
  | "project"
  | "concept"
  | "course"
  | "reflection"
  | "source"
  | "person"
  | "tool"
  | "unknown";

export type TopicFileRole =
  | "overview"
  | "source"
  | "decision"
  | "implementation"
  | "reflection"
  | "reference"
  | "draft"
  | "outdated"
  | "index"
  | "unknown";

export type TopicFile = {
  path: string;
  title: string;
  summary: string;
  role: TopicFileRole;
  relevance: number;
};

export type KnowledgeTopic = {
  id: string;
  title: string;
  category: KnowledgeTopicCategory;
  summary: string;
  keyConcepts: string[];
  relatedFiles: TopicFile[];
  openQuestions: string[];
  confidence: number;
};

export type KnowledgeMap = {
  id: string;
  vaultPath: string;
  scopePath?: string;
  generatedAt: string;
  basedOnScanId: string;
  topics: KnowledgeTopic[];
  summary: string;
};
