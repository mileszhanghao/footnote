import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import { Collapse, Space, Tag, Tooltip, Typography } from 'antd'
import type { AgentAnswer } from '../api'

export default function Answer({ result }: { result: AgentAnswer }) {
  const docs = result.citations.filter((c) => c.type === 'document')
  const web = result.citations.filter((c) => c.type === 'web')

  return (
    <Space orientation="vertical" size="small" style={{ width: '100%' }}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{result.answer}</Typography.Paragraph>
      {(docs.length > 0 || web.length > 0) && (
        <Space size={[4, 4]} wrap>
          {docs.map((c, i) => (
            <Tooltip key={`d${i}`} title={c.excerpt}>
              <Tag icon={<FileTextOutlined />} color="blue">
                p. {c.page}
              </Tag>
            </Tooltip>
          ))}
          {web.map((c) => (
            <Tag key={c.url} icon={<GlobalOutlined />} color="green">
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.title}
              </a>
            </Tag>
          ))}
        </Space>
      )}
      {result.steps.length > 0 && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: 'steps',
              label: `Agent steps (${result.steps.length}) · ${result.model}`,
              children: (
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {result.steps.map((s, i) => (
                    <li key={i}>
                      <Typography.Text code>{s.tool}</Typography.Text>{' '}
                      <Typography.Text type="secondary">{JSON.stringify(s.arguments)}</Typography.Text>
                      {!s.ok && <Tag color="red">failed</Tag>}
                    </li>
                  ))}
                </ol>
              ),
            },
          ]}
        />
      )}
    </Space>
  )
}
