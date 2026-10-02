// The registry of everything that can be exported or printed. Adding a report is adding a file here and one line below.
import type { DatasetDefinition } from '../kit'
import { auditDataset } from './audit'
import { projectReportDataset, workspaceSummaryDataset } from './documents'
import { peopleDataset, usersDataset } from './directory'
import { milestonesDataset, projectsDataset } from './projects'
import { activityLogDataset, activityProjectsDataset, activitySummaryDataset, deliveryDataset } from './reports'
import { tasksDataset } from './tasks'
import { activityDataset, alertsDataset } from './workstream'

export const DATASETS: readonly DatasetDefinition[] = [
  tasksDataset,
  projectsDataset,
  milestonesDataset,
  peopleDataset,
  alertsDataset,
  activityDataset,
  deliveryDataset,
  activityLogDataset,
  activitySummaryDataset,
  activityProjectsDataset,
  usersDataset,
  auditDataset,
  projectReportDataset,
  workspaceSummaryDataset
]

export const datasetById = (id: string) => DATASETS.find(dataset => dataset.id === id)
