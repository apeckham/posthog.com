/* eslint-disable @typescript-eslint/no-var-requires */
const fetch = require('node-fetch')
const queryString = require('query-string')
const gravatar = require('gravatar')
const formData = require('form-data')
const Mailgun = require('mailgun.js')

exports.handler = async (e) => {
    let { body } = e
    if (!body) return { statusCode: 500, body: 'Missing body' }
    const { payload } = queryString.parse(body)
    const { trigger_id, actions, token, type } = JSON.parse(payload)
    if (token !== process.env.SLACK_VERIFICATION_TOKEN) return { statusCode: 500, body: 'Invalid token' }
    if (type === 'block_actions' && actions[0]['action_id'] === 'answer-question-button') {
        const { question, name, email, slug, timestamp } = JSON.parse(actions[0].value)
        fetch('https://slack.com/api/views.open', {
            method: 'POST',
            body: JSON.stringify({
                trigger_id: trigger_id,
                view: {
                    private_metadata: timestamp || '',
                    type: 'modal',
                    title: {
                        type: 'plain_text',
                        text: `${name}'s question`,
                        emoji: true,
                    },
                    submit: {
                        type: 'plain_text',
                        text: 'Publish answer',
                        emoji: true,
                    },
                    close: {
                        type: 'plain_text',
                        text: 'Cancel',
                        emoji: true,
                    },
                    blocks: [
                        {
                            type: 'input',
                            element: {
                                type: 'plain_text_input',
                                action_id: 'modal-slug',
                                initial_value: slug,
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Slug',
                                emoji: true,
                            },
                        },
                        {
                            type: 'input',
                            element: {
                                type: 'plain_text_input',
                                action_id: 'modal-full-name',
                                initial_value: name,
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Name',
                                emoji: true,
                            },
                        },
                        {
                            type: 'input',
                            element: {
                                type: 'plain_text_input',
                                action_id: 'modal-email',
                                initial_value: email,
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Email',
                                emoji: true,
                            },
                        },
                        {
                            type: 'input',
                            element: {
                                type: 'plain_text_input',
                                multiline: true,
                                action_id: 'modal-question',
                                initial_value: question,
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Question',
                                emoji: true,
                            },
                        },
                        {
                            type: 'input',
                            element: {
                                type: 'plain_text_input',
                                multiline: true,
                                action_id: 'modal-answer',
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Answer',
                                emoji: true,
                            },
                        },
                    ],
                },
            }),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SLACK_API_KEY}` },
        })
    } else if (type === 'view_submission') {
        const {
            user: { username },
            view: {
                private_metadata,
                state: { values },
            },
        } = JSON.parse(payload)
        let modalQuestion
        let modalAnswer
        let modalSlug
        let modalName
        let avatar
        let modalEmail
        Object.keys(values).forEach((key) => {
            if (values[key]['modal-question']) {
                modalQuestion = values[key]['modal-question'].value
            }
            if (values[key]['modal-answer']) {
                modalAnswer = values[key]['modal-answer'].value
            }
            if (values[key]['modal-slug']) {
                modalSlug = values[key]['modal-slug'].value
            }
            if (values[key]['modal-full-name']) {
                modalName = values[key]['modal-full-name'].value
            }
            if (values[key]['modal-email']) {
                modalEmail = values[key]['modal-email'].value
                avatar = gravatar.url(modalEmail)
            }
        })

        const mailgun = new Mailgun(formData)
        const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY })
        const mailgunData = {
            from: 'hey@posthog.com',
            to: modalEmail,
            subject: `Someone answered your question on posthog.com!`,
            template: 'question-answered',
            'h:X-Mailgun-Variables': JSON.stringify({
                question: modalQuestion,
                answer: modalAnswer,
            }),
            'h:Reply-To': 'hey@posthog.com',
        }
        await mg.messages.create(process.env.MAILGUN_DOMAIN, mailgunData).catch((err) => console.log(err))

        avatar = await fetch(`https:${avatar}?d=404`).then((res) => (res.ok && `https:${avatar}`) || '')

        await fetch('https://slack.com/api/chat.update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.SLACK_API_KEY}`,
            },
            body: JSON.stringify({
                channel: process.env.SLACK_QUESTION_CHANNEL,
                ts: private_metadata,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: 'Question',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Author: ${modalName}`,
                            emoji: true,
                        },
                        block_id: 'question_author',
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Avatar: ${avatar}`,
                        },
                        block_id: 'question_avatar',
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Slug: ${modalSlug}`,
                            emoji: true,
                        },
                        block_id: 'question_slug',
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Body: ${modalQuestion}`,
                        },
                        block_id: 'question_body',
                    },
                    {
                        type: 'divider',
                    },
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: 'Answer',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Author: ${username}`,
                            emoji: true,
                        },
                        block_id: 'answer_author',
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'plain_text',
                            text: `Body: ${modalAnswer}`,
                        },
                        block_id: 'answer_body',
                    },
                ],
            }),
        })
    }

    return {
        statusCode: 200,
    }
}
