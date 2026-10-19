import type { ClientTaskStatus } from "@prisma/client";

// Client work is tracked as cards on one board per service (Production, Marketing Consultation, Web Development, Graphic Design). The columns, work types and,
// for Web and Graphic, the task list each project type starts with live here — the client page reads them from /crm/service-boards,
// so there is one copy. A card's status (To Do / In Progress / Review / Done) always follows its column; My Tasks, the Calendar and the
// dashboards read the status. Days on a project task = most working days it is allowed.

export type ServiceBoard = {
  noun: string;
  stages: string[];
  types: string[];
  platforms: string[];
  flagLate?: boolean;
  projectTasks?: Record<string, { name: string; days: number }[]>;
  // Marketing Consultation: created for every month a client takes it. Retained clients skip the "new clients only" ones.
  monthlyTasks?: { name: string; days: number; type: string; newOnly?: boolean }[];
};

export const SERVICE_BOARDS: Record<string, ServiceBoard> = {
  "Marketing Consultation": {
    "noun": "task",
    "stages": [
      "Open",
      "In progress",
      "Review",
      "Done"
    ],
    "flagLate": true,
    "types": [
      "Briefing",
      "Plan",
      "Presentation",
      "Follow-up meeting",
      "Report",
      "Other"
    ],
    "platforms": [],
    "monthlyTasks": [
      {
        "name": "Client briefing",
        "days": 1,
        "type": "Briefing",
        "newOnly": true
      },
      {
        "name": "Marketing plan preparation",
        "days": 3,
        "type": "Plan",
        "newOnly": true
      },
      {
        "name": "Plan presentation",
        "days": 1,
        "type": "Presentation"
      },
      {
        "name": "Week 1 follow-up meeting",
        "days": 5,
        "type": "Follow-up meeting"
      },
      {
        "name": "Week 2 follow-up meeting",
        "days": 5,
        "type": "Follow-up meeting"
      },
      {
        "name": "Week 3 follow-up meeting",
        "days": 5,
        "type": "Follow-up meeting"
      },
      {
        "name": "Week 4 follow-up meeting",
        "days": 5,
        "type": "Follow-up meeting"
      },
      {
        "name": "Report and feedback",
        "days": 2,
        "type": "Report"
      }
    ]
  },
  "Production": {
    "noun": "deliverable",
    "stages": [
      "Idea",
      "Scripting",
      "Production",
      "Edit",
      "Graphics",
      "Review",
      "Scheduled",
      "Published"
    ],
    "types": [
      "Reel",
      "Ad film",
      "Product video",
      "Photoshoot",
      "Testimonial",
      "Corporate video",
      "Event coverage"
    ],
    "platforms": [
      "Instagram",
      "Facebook",
      "YouTube",
      "LinkedIn",
      "Website",
      "Ads"
    ]
  },
  "Web Development": {
    "noun": "task",
    "stages": [
      "Open",
      "In progress",
      "Review",
      "Done"
    ],
    "flagLate": true,
    "platforms": [],
    "types": [
      "Static website",
      "Dynamic website",
      "Shopify store",
      "Landing page",
      "Website update"
    ],
    "projectTasks": {
      "Static website": [
        {
          "name": "Kickoff call & brief",
          "days": 1
        },
        {
          "name": "Content & asset collection",
          "days": 1
        },
        {
          "name": "Sitemap & content plan",
          "days": 1
        },
        {
          "name": "Design mockups",
          "days": 2
        },
        {
          "name": "Build & responsive development",
          "days": 3
        },
        {
          "name": "Internal QA",
          "days": 1
        },
        {
          "name": "Staging link review",
          "days": 1
        },
        {
          "name": "Revision round 1",
          "days": 1
        },
        {
          "name": "Revision round 2",
          "days": 1
        },
        {
          "name": "Final approval",
          "days": 1
        },
        {
          "name": "Launch & handoff",
          "days": 1
        }
      ],
      "Dynamic website": [
        {
          "name": "Kickoff call & brief",
          "days": 1
        },
        {
          "name": "Content & asset collection",
          "days": 2
        },
        {
          "name": "Sitemap & content plan",
          "days": 2
        },
        {
          "name": "Design mockups",
          "days": 3
        },
        {
          "name": "Build with CMS & blog",
          "days": 6
        },
        {
          "name": "Internal QA",
          "days": 1
        },
        {
          "name": "Staging link review",
          "days": 2
        },
        {
          "name": "Revision round 1",
          "days": 1
        },
        {
          "name": "Revision round 2",
          "days": 1
        },
        {
          "name": "Final approval",
          "days": 1
        },
        {
          "name": "CMS walkthrough",
          "days": 1
        },
        {
          "name": "Launch & handoff",
          "days": 1
        }
      ],
      "Shopify store": [
        {
          "name": "Kickoff call & brief",
          "days": 1
        },
        {
          "name": "Content & product data collection",
          "days": 2
        },
        {
          "name": "Product catalog & sitemap plan",
          "days": 2
        },
        {
          "name": "Theme design",
          "days": 3
        },
        {
          "name": "Store build — theme, payments, shipping",
          "days": 6
        },
        {
          "name": "Internal QA",
          "days": 1
        },
        {
          "name": "Staging store review",
          "days": 2
        },
        {
          "name": "Revision round 1",
          "days": 1
        },
        {
          "name": "Revision round 2",
          "days": 1
        },
        {
          "name": "Final approval",
          "days": 1
        },
        {
          "name": "Store walkthrough",
          "days": 1
        },
        {
          "name": "Launch — payment gateway live",
          "days": 1
        }
      ],
      "Landing page": [
        {
          "name": "Brief & goals",
          "days": 1
        },
        {
          "name": "Copy & assets",
          "days": 1
        },
        {
          "name": "Design",
          "days": 2
        },
        {
          "name": "Build",
          "days": 2
        },
        {
          "name": "Internal QA",
          "days": 1
        },
        {
          "name": "Client review",
          "days": 1
        },
        {
          "name": "Revisions",
          "days": 1
        },
        {
          "name": "Launch",
          "days": 1
        }
      ],
      "Website update": [
        {
          "name": "Change brief",
          "days": 1
        },
        {
          "name": "Make the changes",
          "days": 2
        },
        {
          "name": "Internal QA",
          "days": 1
        },
        {
          "name": "Client review",
          "days": 1
        },
        {
          "name": "Publish",
          "days": 1
        }
      ]
    }
  },
  "Graphic Design": {
    "noun": "task",
    "stages": [
      "Open",
      "In progress",
      "Review",
      "Done"
    ],
    "flagLate": true,
    "platforms": [],
    "types": [
      "Logo design",
      "Brand identity",
      "Social media posters",
      "Brochure design",
      "Packaging",
      "Print collateral"
    ],
    "projectTasks": {
      "Logo design": [
        {
          "name": "Brief & questionnaire",
          "days": 1
        },
        {
          "name": "Research & moodboard",
          "days": 1
        },
        {
          "name": "Logo concepts (3 routes)",
          "days": 3
        },
        {
          "name": "Concept presentation",
          "days": 1
        },
        {
          "name": "Revision round 1",
          "days": 1
        },
        {
          "name": "Revision round 2",
          "days": 1
        },
        {
          "name": "Final logo files",
          "days": 1
        }
      ],
      "Brand identity": [
        {
          "name": "Brief & questionnaire",
          "days": 1
        },
        {
          "name": "Research & moodboard",
          "days": 2
        },
        {
          "name": "Logo concepts",
          "days": 3
        },
        {
          "name": "Concept presentation",
          "days": 1
        },
        {
          "name": "Refinement rounds",
          "days": 2
        },
        {
          "name": "Brand guide",
          "days": 2
        },
        {
          "name": "Final files & handover",
          "days": 1
        }
      ],
      "Social media posters": [
        {
          "name": "Brief, copy & references",
          "days": 1
        },
        {
          "name": "Poster drafts",
          "days": 1
        },
        {
          "name": "Internal review",
          "days": 1
        },
        {
          "name": "Client feedback & revisions",
          "days": 1
        },
        {
          "name": "Final export",
          "days": 1
        }
      ],
      "Brochure design": [
        {
          "name": "Brief & content collection",
          "days": 1
        },
        {
          "name": "Layout & cover concepts",
          "days": 2
        },
        {
          "name": "Full brochure design",
          "days": 3
        },
        {
          "name": "Internal proofread",
          "days": 1
        },
        {
          "name": "Client review & revisions",
          "days": 2
        },
        {
          "name": "Print-ready PDF & handover",
          "days": 1
        }
      ],
      "Packaging": [
        {
          "name": "Brief & dieline",
          "days": 1
        },
        {
          "name": "Packaging concepts",
          "days": 3
        },
        {
          "name": "3D mockups",
          "days": 1
        },
        {
          "name": "Client review & revisions",
          "days": 2
        },
        {
          "name": "Print files",
          "days": 1
        }
      ],
      "Print collateral": [
        {
          "name": "Brief",
          "days": 1
        },
        {
          "name": "Design",
          "days": 2
        },
        {
          "name": "Client review & revisions",
          "days": 1
        },
        {
          "name": "Print-ready files",
          "days": 1
        }
      ]
    }
  }
};

export const boardOf = (service: string | null | undefined): ServiceBoard | null => (service ? SERVICE_BOARDS[service] ?? null : null);

// First column = To Do, last = Done, a column named Review/Approval = Review, anything between = In Progress.
export function boardStageStatus(service: string, stage: string): ClientTaskStatus {
  const st = SERVICE_BOARDS[service]?.stages ?? [];
  const i = st.indexOf(stage);
  if (i === st.length - 1) return "DONE";
  if (i <= 0) return "TODO";
  return /review|approval/i.test(stage) ? "REVIEW" : "IN_PROGRESS";
}

// My Tasks moves a card by status — find the column that matches (staying put if the card already is in one).
export function stageForStatus(service: string, status: ClientTaskStatus, cur: string | null): string | null {
  const st = SERVICE_BOARDS[service]?.stages ?? [];
  if (!st.length) return cur;
  if (cur && boardStageStatus(service, cur) === status) return cur;
  if (status === "DONE") return st[st.length - 1];
  if (status === "TODO") return st[0];
  if (status === "REVIEW") return st.find((x) => boardStageStatus(service, x) === "REVIEW") ?? st[st.length - 2];
  const ci = cur ? st.indexOf(cur) : -1;
  const prog = st.map((x, i) => [x, i] as const).filter(([x]) => boardStageStatus(service, x) === "IN_PROGRESS");
  if (!prog.length) return st[1];
  return [...prog].sort((a, b) => Math.abs(a[1] - ci) - Math.abs(b[1] - ci) || b[1] - a[1])[0][0];
}

// The tasks a consultation month starts with.
export const cycleTasks = (retained: boolean) => (SERVICE_BOARDS["Marketing Consultation"].monthlyTasks ?? []).filter((r) => !(retained && r.newOnly));
