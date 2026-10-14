import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DocumentsPanel } from '../components/DocumentsPanel'
import { makeSettings } from './fixtures'
import type { DocumentInfo } from '../lib/rag'

const doc = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: 'd1', name: 'cv.pdf', ext: 'pdf', size: 52_000, addedAt: 0, enabled: true, chunkCount: 12, embeddingModel: null, ...over,
})

const setup = (props: Partial<React.ComponentProps<typeof DocumentsPanel>> = {}) => {
  const updateSettings = vi.fn()
  render(<DocumentsPanel settings={makeSettings()} embeddingModels={[]} isConnected updateSettings={updateSettings} onBack={vi.fn()} {...props} />)
  return { updateSettings }
}

describe('DocumentsPanel', () => {
  it('should list documents with their indexing mode', async () => {
    window.ghostAPI.docsList = vi.fn().mockResolvedValue({ docs: [doc(), doc({ id: 'd2', name: 'job.md', embeddingModel: 'nomic-embed-text:latest', chunkCount: 1 })] })
    setup()
    expect(await screen.findByText('cv.pdf')).toBeInTheDocument()
    expect(screen.getByText(/12 excerpts · keyword$/)).toBeInTheDocument()
    expect(screen.getByText(/1 excerpt · semantic \+ keyword/)).toBeInTheDocument()
  })

  it('should add documents through the file picker and show errors', async () => {
    window.ghostAPI.docsAdd = vi.fn().mockResolvedValue({ added: [doc()], errors: [{ name: 'scan.pdf', error: 'No text found' }] })
    window.ghostAPI.docsList = vi.fn().mockResolvedValueOnce({ docs: [] }).mockResolvedValue({ docs: [doc()] })
    setup()
    fireEvent.click(screen.getByText('Add'))
    expect(await screen.findByText('cv.pdf')).toBeInTheDocument()
    expect(window.ghostAPI.docsAdd).toHaveBeenCalledWith({ baseUrl: 'http://localhost:11434', embeddingModel: 'nomic-embed-text' })
    expect(screen.getByRole('alert')).toHaveTextContent('scan.pdf: No text found')
  })

  it('should turn documents off and remove them', async () => {
    window.ghostAPI.docsList = vi.fn().mockResolvedValue({ docs: [doc()] })
    window.ghostAPI.docsSetEnabled = vi.fn().mockResolvedValue({ docs: [doc({ enabled: false })] })
    window.ghostAPI.docsRemove = vi.fn().mockResolvedValue({ docs: [] })
    setup()
    fireEvent.click(await screen.findByLabelText('Use cv.pdf'))
    await waitFor(() => expect(screen.getByLabelText('Use cv.pdf')).not.toBeChecked())
    expect(window.ghostAPI.docsSetEnabled).toHaveBeenCalledWith('d1', false)
    fireEvent.click(screen.getByTitle('Remove cv.pdf'))
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
  })

  it('should suggest installing an embedding model when none is available', async () => {
    setup()
    expect(await screen.findByText('ollama pull nomic-embed-text')).toBeInTheDocument()
    expect(screen.getByText(/Keyword search only/)).toBeInTheDocument()
  })

  it('should offer to index existing documents once the model is installed', async () => {
    window.ghostAPI.docsList = vi.fn().mockResolvedValue({ docs: [doc()] })
    window.ghostAPI.docsReindex = vi.fn().mockResolvedValue({ reindexed: 1 })
    setup({ embeddingModels: ['nomic-embed-text:latest'] })
    expect(await screen.findByText('nomic-embed-text:latest')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Index existing documents'))
    await waitFor(() => expect(window.ghostAPI.docsReindex).toHaveBeenCalled())
  })
})
