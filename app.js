const express = require('express');
const multer = require('multer');
const mysql = require('mysql2');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Cấu hình kết nối MySQL
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',  // Thay đổi thành mật khẩu của bạn
    database: ''     // Thay đổi thành tên cơ sở dữ liệu của bạn
});

// Kết nối MySQL
connection.connect((err) => {
    if (err) {
        console.error('Lỗi kết nối MySQL:', err);
        return;
    }
    console.log('Kết nối MySQL thành công!');
});

// Hàm tạo bảng nếu chưa tồn tại
const createTableIfNotExists = () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS bank_transfers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date_time DATETIME,
            trans_no VARCHAR(50),
            credit DECIMAL(10, 2),
            debit DECIMAL(10, 2),
            detail VARCHAR(255)
        );
    `;

    connection.query(createTableQuery, (err) => {
        if (err) {
            console.error('Lỗi tạo bảng:', err);
        } else {
            console.log('Bảng bank_transfers đã được tạo hoặc đã tồn tại.');
        }
    });
};

// Hàm chèn dữ liệu vào MySQL
const insertData = (data) => {
    const query = `INSERT INTO bank_transfers (date_time, trans_no, credit, debit, detail) VALUES ?`;
    const values = data.map(row => [row.date_time, row.trans_no, row.credit, row.debit, row.detail]);

    connection.query(query, [values], (err) => {
        if (err) {
            console.error('Lỗi chèn dữ liệu:', err);
        } else {
            console.log('Chèn dữ liệu thành công!');
        }
    });
};

const batchInsertData = (data, batchSize = 1000) => {
    const totalBatches = Math.ceil(data.length / batchSize);
    let batchPromises = [];

    for (let i = 0; i < totalBatches; i++) {
        const batch = data.slice(i * batchSize, (i + 1) * batchSize);
        batchPromises.push(new Promise((resolve) => {
            insertData(batch);
            resolve();
        }));
    }

    Promise.all(batchPromises)
        .then(() => {
            console.log('Tất cả dữ liệu đã được chèn thành công!');
        })
        .catch(err => {
            console.error('Lỗi trong quá trình chèn dữ liệu:', err);
        });
};

// Tải lên tệp CSV
app.post('/uploads', upload.single('file'), (req, res) => {
    const filePath = path.join(__dirname, req.file.path);
    const results = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => {
            if (results.length > 0) {
                batchInsertData(results); // Chèn dữ liệu vào MySQL
                res.send('Tệp đã được tải lên và xử lý thành công!');
            } else {
                res.send('Không có dữ liệu nào để chèn.');
            }
            fs.unlinkSync(filePath); // Xóa tệp sau khi xử lý
        });
});



// Phục vụ tệp HTML
app.use(express.static('public'));

// Khởi động máy chủ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Máy chủ đang chạy trên http://localhost:${PORT}`);
});
