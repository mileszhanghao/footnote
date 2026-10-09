import { AudioOutlined, InboxOutlined, SoundOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Button, Card, Empty, Input, Layout, Select, Space, Switch, Tooltip, Typography, Upload } from 'antd'
import { useState } from 'react'
import { api, type AgentAnswer } from './api'
import Answer from './components/Answer'
import { useVoice } from './useVoice'

const { Header, Content } = Layout

interface Turn {
  question: string
  result?: AgentAnswer
  error?: string
}

export default function App() {
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health })
  const documents = useQuery({ queryKey: ['documents'], queryFn: api.documents })
  const [selectedId, setSelectedId] = useState<string>()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [speakAnswers, setSpeakAnswers] = useState(false)

  const activeId = selectedId ?? documents.data?.[0]?.id

  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setSelectedId(doc.id)
      setTurns([])
      message.success(`Indexed ${doc.name}: ${doc.pages} pages, ${doc.chunks} chunks`)
    },
    onError: (error) => message.error(error.message),
  })

  const ask = useMutation({
    mutationFn: (q: string) => api.ask(activeId!, q),
    onMutate: (q) => setTurns((prev) => [...prev, { question: q }]),
    onSuccess: (result) => {
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, result } : t)))
      if (speakAnswers) voice.speak(result.answer)
    },
    onError: (error) => setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, error: error.message } : t))),
  })

  const submit = (q: string) => {
    const text = q.trim()
    if (!text || !activeId || ask.isPending) return
    setQuestion('')
    ask.mutate(text)
  }

  const voice = useVoice(submit)
  const offline = health.data?.model.startsWith('local:')

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
          AgentAI
        </Typography.Title>
      </Header>
      <Content style={{ padding: '24px 16px', maxWidth: 900, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          {offline && (
            <Alert
              type="info"
              showIcon
              title="Offline mode"
              description="No OpenAI key is configured, so the server uses local keyword search and replies with the most relevant passages instead of a generated answer. Set OPENAI_API_KEY to enable the LLM agent."
            />
          )}

          <Upload.Dragger
            accept="application/pdf"
            showUploadList={false}
            disabled={upload.isPending}
            customRequest={({ file }) => upload.mutate(file as File)}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">{upload.isPending ? 'Indexing…' : 'Click or drag a PDF here'}</p>
            <p className="ant-upload-hint">It is split into chunks and indexed once, then you can ask questions about it.</p>
          </Upload.Dragger>

          <Select
            style={{ width: '100%' }}
            placeholder="Upload a PDF to get started"
            value={activeId}
            onChange={(id) => {
              setSelectedId(id)
              setTurns([])
            }}
            options={documents.data?.map((d) => ({ value: d.id, label: `${d.name} · ${d.pages} pages` }))}
          />

          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            {turns.length === 0 && <Empty description="Ask a question about the selected document" />}
            {turns.map((turn, i) => (
              <Card key={i} size="small" title={turn.question} loading={!turn.result && !turn.error}>
                {turn.error && <Typography.Text type="danger">{turn.error}</Typography.Text>}
                {turn.result && <Answer result={turn.result} />}
              </Card>
            ))}
          </Space>

          <Space.Compact style={{ width: '100%' }}>
            <Input.Search
              placeholder={activeId ? 'Ask about the document…' : 'Upload a PDF first'}
              enterButton="Ask"
              size="large"
              disabled={!activeId}
              loading={ask.isPending}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onSearch={submit}
            />
            {voice.supported && (
              <Tooltip title={voice.listening ? 'Stop listening' : 'Ask by voice'}>
                <Button
                  size="large"
                  aria-label="Ask by voice"
                  icon={<AudioOutlined />}
                  danger={voice.listening}
                  disabled={!activeId}
                  onClick={voice.listening ? voice.stop : voice.start}
                />
              </Tooltip>
            )}
          </Space.Compact>
          <Space>
            <SoundOutlined />
            <Typography.Text>Read answers aloud</Typography.Text>
            <Switch size="small" checked={speakAnswers} onChange={setSpeakAnswers} />
          </Space>
        </Space>
      </Content>
    </Layout>
  )
}
