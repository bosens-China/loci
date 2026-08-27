import { Button, Popconfirm, type ButtonProps } from 'antd'

export function ConfirmedActionButton(props: {
  title: string
  description?: string
  label: string
  icon: React.ReactNode
  loading: boolean
  danger?: boolean
  disabled?: boolean
  type?: ButtonProps['type']
  size?: ButtonProps['size']
  onConfirm: () => void | Promise<void>
}): React.JSX.Element {
  return (
    <Popconfirm
      title={props.title}
      description={props.description}
      okText={props.label}
      cancelText="返回"
      okButtonProps={props.danger ? { danger: true } : undefined}
      onConfirm={props.onConfirm}
    >
      <Button
        danger={props.danger}
        disabled={props.disabled}
        loading={props.loading}
        icon={props.icon}
        type={props.type ?? 'text'}
        size={props.size ?? 'small'}
      >
        {props.label}
      </Button>
    </Popconfirm>
  )
}
