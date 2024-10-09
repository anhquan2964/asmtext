const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise'); // Sử dụng phiên bản promise
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

const app = express();
// Thiết lập EJS làm view engine
app.set('view engine', 'ejs');

const upload = multer({ dest: 'uploads/' });

// Cấu hình pool kết nối MySQL
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'data' // Bạn có thể chỉ định cơ sở dữ liệu ở đây
});

// Kết nối và tạo bảng nếu chưa tồn tại
const createDatabaseAndTable = async () => {
    try {
        // Tạo cơ sở dữ liệu nếu chưa tồn tại
        await pool.query('CREATE DATABASE IF NOT EXISTS data');
        console.log('Cơ sở dữ liệu "data" đã được tạo hoặc đã tồn tại.');

        // Kết nối lại với cơ sở dữ liệu mới tạo
        const dbConnection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'data' // Kết nối đến cơ sở dữ liệu vừa tạo
        });

        // Tạo bảng 
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS datas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                date_time VARCHAR(255),
                time TIME,
                trans_no VARCHAR(255),
                credit DECIMAL(10, 2),
                debit DECIMAL(10, 2),
                detail TEXT
            )
        `;
        await dbConnection.query(createTableQuery);
        console.log('Bảng đã được tạo');

        // Đóng kết nối
        await dbConnection.end();
    } catch (err) {
        console.error('Lỗi tạo cơ sở dữ liệu hoặc bảng:', err);
    }
};

// Gọi hàm tạo cơ sở dữ liệu và bảng
createDatabaseAndTable();

// Hàm phân tích và chuyển đổi thời gian
function parseAndConvertTime(str) {
    const parts = str.split("_");
    const datePart = parts[0];  // "01/09/2024"
    const numberPart = parts[1]; // "6215.97152"

    const seconds = parseFloat(numberPart); // Chuyển đổi chuỗi số thành số thực
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60); // Làm tròn giây

    // Tạo đối tượng thời gian theo định dạng HH:mm:ss
    const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;

    return {
        date: datePart,
        time: time
    };
}

// Hàm chèn dữ liệu vào MySQL
const insertData = async (data) => {
    // Kết nối đến cơ sở dữ liệu 'data'
    const dbConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'data'
    });

    const query = `INSERT INTO datas (date_time, time, trans_no, credit, debit, detail) VALUES ?`;
    const values = data.map(row => {
        const { date, time } = parseAndConvertTime(row.date_time);
        return [date, time, row.trans_no, row.credit, row.debit, row.detail];
    });

    const batchSize = 1000; // Kích thước batch
    for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        await dbConnection.query(query, [batch]);
    }

    console.log('Chèn dữ liệu thành công!');

    // Đóng kết nối
    await dbConnection.end();
};


// Tải lên tệp CSV
app.post('/uploads', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Vui lòng tải lên một tệp CSV.');
    }

    const filePath = path.join(__dirname, req.file.path);
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Sử dụng PapaParse để phân tích CSV
    Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {            
            if (results.data.length > 0) {
                try {
                    await insertData(results.data); // Chèn dữ liệu vào MySQL
                    res.send('Tệp CSV đã được xử lý và dữ liệu đã được chèn vào MySQL.'); // Thông báo cho người dùng
                } catch (error) {
                    console.error('Có lỗi xảy ra trong quá trình chèn dữ liệu:', error);
                    res.status(500).send('Có lỗi xảy ra trong quá trình chèn dữ liệu.');
                }
            } else {
                res.send('Không có dữ liệu nào để chèn.');
            }

            fs.unlinkSync(filePath); // Xóa tệp sau khi xử lý
        },
        error: (error) => {
            console.error('Lỗi khi phân tích:', error);
            res.status(500).send('Có lỗi xảy ra trong quá trình phân tích tệp CSV.');
        }
    });
});

// Route thống kê tổng số tiền nhận được theo ngày hoặc theo khoảng thời gian
// Route tìm kiếm giao dịch theo nội dung hoặc số tiền
// app.get('/statistics', async (req, res) => {
//     const { start_date, end_date } = req.query;

//     try {
//         // Kiểm tra nếu người dùng không nhập ngày
//         if (!start_date || !end_date) {
//             return res.status(400).send('Vui lòng nhập đầy đủ ngày bắt đầu và ngày kết thúc.');
//         }

//         // Truy vấn tổng số tiền nhận được (credit) theo khoảng thời gian
//         const query = `
//             SELECT DATE(date_time) AS date, SUM(credit) AS total_credit
//             FROM datas
//             WHERE date_time BETWEEN ? AND ?
//             GROUP BY DATE(date_time)
//             ORDER BY DATE(date_time) ASC
//         `;
//         const [results] = await pool.query(query, [start_date, end_date]);

//         // Hiển thị kết quả
//         res.render('products/statistics', { results, start_date, end_date });
//     } catch (err) {
//         console.error('Lỗi khi truy vấn thống kê:', err);
//         res.status(500).send('Có lỗi xảy ra trong quá trình thống kê.');
//     }
// });

app.get('/filter', async (req, res) => {
    const { start_date, end_date } = req.query;

    // Nếu không có ngày được truyền, trả về trang index ban đầu với mảng dataResults rỗng.
    if (!start_date || !end_date) {
        return res.render('products/index', { 
            totalCredit: 0, 
            dataResults: [] // Truyền mảng rỗng nếu không có dữ liệu
        });
    }

    const startDateFormatted = start_date.split("-").reverse().join("-");
    const endDateFormatted = end_date.split("-").reverse().join("-");

    const queryTotalCredit = `
        SELECT SUM(COALESCE(credit, 0)) AS totalCredit 
        FROM datas 
        WHERE date_time >= ? AND date_time <= ?`;

    const queryData = `
        SELECT id, date_time, trans_no, credit, debit, detail 
        FROM datas 
        WHERE date_time >= ? AND date_time <= ?`;

    try {
        const [creditResults] = await pool.query(queryTotalCredit, [startDateFormatted, endDateFormatted]);
        const totalCredit = creditResults[0].totalCredit || 0;

        const [dataResults] = await pool.query(queryData, [startDateFormatted, endDateFormatted]);

        // Luôn truyền dữ liệu cho view
        res.render('products/index', { 
            totalCredit, 
            dataResults: dataResults || [] // Truyền mảng rỗng nếu không có kết quả
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu:', error);
        res.status(500).send('Có lỗi xảy ra.');
    }
});


// Trang chính
app.get('/', (req, res) => {
    res.render('products/index');
});

// Hiển thị dữ liệu với phân trang
app.get('/data', async (req, res) => {
    // Cấu hình pool kết nối MySQL
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'data' // Chỉ định cơ sở dữ liệu ở đây
});

    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const [totalResults] = await pool.query('SELECT COUNT(*) as total FROM datas');
        const total = totalResults[0].total;
        const totalPages = Math.ceil(total / limit);

        const [results] = await pool.query('SELECT * FROM datas LIMIT ? OFFSET ?', [limit, offset]);
        res.render('products/data', { results, currentPage: Math.floor(offset / limit) + 1, totalPages, limit });
    } catch (err) {
        console.error('Lỗi truy vấn dữ liệu:', err); // In chi tiết lỗi ra console
        res.status(500).send('Có lỗi xảy ra trong quá trình truy vấn dữ liệu.');
    }
});


// Phục vụ tệp HTML
app.use(express.static('public'));

// Khởi động máy chủ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Máy chủ đang chạy trên http://localhost:${PORT}`);
});
