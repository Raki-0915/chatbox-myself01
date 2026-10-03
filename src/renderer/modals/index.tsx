import NiceModal from '@ebay/nice-modal-react'
import CopilotSettingsModal from '../routes/copilots/-components/CopilotSettingsModal'
import AgentModeRewardClaimSuccess from './AgentModeRewardClaimSuccess'
import AppStoreRating from './AppStoreRating'
import ArtifactPreview from './ArtifactPreview'
import ClearSessionList from './ClearSessionList'
import ConfirmModal from './ConfirmModal'
import ContentViewer from './ContentViewer'
import CreativeLoadSheet from './CreativeLoadSheet'
import ModUpdatePreview from './ModUpdatePreview'
import ExportChat from './ExportChat'
import FileParseError from './FileParseError'
import JsonViewer from './JsonViewer'
import MessageEdit from './MessageEdit'
import ModelEdit from './ModelEdit'
import ReportContent from './ReportContent'
import SessionSettings from './SessionSettings'
import ThreadNameEdit from './ThreadNameEdit'
import VibedropPublish from './VibedropPublish'
import Welcome from './Welcome'

NiceModal.register('welcome', Welcome)
NiceModal.register('agent-mode-reward-claim-success', AgentModeRewardClaimSuccess)
NiceModal.register('file-parse-error', FileParseError)
NiceModal.register('content-viewer', ContentViewer)
NiceModal.register('session-settings', SessionSettings)
NiceModal.register('creative-load-sheet', CreativeLoadSheet)
NiceModal.register('mod-update-preview', ModUpdatePreview)
NiceModal.register('app-store-rating', AppStoreRating)
NiceModal.register('artifact-preview', ArtifactPreview)
NiceModal.register('clear-session-list', ClearSessionList)
NiceModal.register('confirm', ConfirmModal)
NiceModal.register('export-chat', ExportChat)
NiceModal.register('message-edit', MessageEdit)
NiceModal.register('json-viewer', JsonViewer)
NiceModal.register('report-content', ReportContent)
NiceModal.register('model-edit', ModelEdit)
NiceModal.register('thread-name-edit', ThreadNameEdit)
NiceModal.register('vibedrop-publish', VibedropPublish)
NiceModal.register('copilot-settings', CopilotSettingsModal)
